// QA for the fast page: loads it over HTTP in headless Chrome, captures screenshots,
// measures navigation->ready time (also with 4x CPU throttling), and dumps metrics/errors.
// Usage: node tools/qa_fast.mjs <url> <out dir> [--throttle]
import {spawn} from 'node:child_process';
import {mkdtempSync, writeFileSync, mkdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';

const url = process.argv[2];
const outDir = resolve(process.argv[3] || '.');
const throttle = process.argv.includes('--throttle');
if (!url) { console.error('usage: node tools/qa_fast.mjs <url> <out dir> [--throttle]'); process.exit(2); }
mkdirSync(outDir, {recursive: true});

const chromeExe = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = mkdtempSync(join(tmpdir(), 'krusty-fast-qa-'));
const debugPort = 9300 + Math.floor(Math.random() * 500);
const chromeArgs = ['--headless=new', '--remote-debugging-port=' + debugPort, '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  '--autoplay-policy=no-user-gesture-required'];
if (process.env.KRUSTY_PROXY) chromeArgs.push('--proxy-server=' + process.env.KRUSTY_PROXY);
chromeArgs.push('about:blank');
const chrome = spawn(chromeExe, chromeArgs, {windowsHide: true, stdio: 'ignore'});
let socket;
const errors = [], results = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  const port = await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(Error('Chrome startup timeout')), 25000);
    (async () => {
      for (let n = 0; n < 250; n++) {
        try { const r = await fetch(`http://127.0.0.1:${debugPort}/json/version`); if (r.ok) { clearTimeout(timer); return done(debugPort); } } catch {}
        await sleep(100);
      }
      clearTimeout(timer); fail(Error('Chrome devtools endpoint not reachable'));
    })();
  });
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  socket = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => socket.addEventListener('open', r, {once: true}));
  let id = 0; const pending = new Map();
  socket.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.fail(Error(JSON.stringify(m.error))); else p.done(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
  };
  const send = (method, params = {}) => new Promise((done, fail) => { const n = ++id; pending.set(n, {done, fail}); socket.send(JSON.stringify({id: n, method, params})); });
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', {width: 1440, height: 1150, deviceScaleFactor: 1, mobile: false});
  if (throttle) await send('Emulation.setCPUThrottlingRate', {rate: 4});

  let transferred = 0; const urls = [];
  socket.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Network.loadingFinished') transferred += m.params.encodedDataLength || 0;
    if (m.method === 'Network.responseReceived') urls.push(m.params.response.url.split('/').pop() + ' ' + m.params.response.status + ' ' + (m.params.response.headers['content-length'] || '?'));
  });

  const t0 = Date.now();
  await send('Page.navigate', {url});
  let readyAt = null;
  for (let n = 0; n < 300; n++) { if (await evaluate('Boolean(window.__krusty)')) { readyAt = Date.now() - t0; break; } await sleep(100); }
  if (readyAt === null) { console.log(JSON.stringify({errors, body: await evaluate('document.body.innerText.slice(-800)')}, null, 2)); throw Error('viewer not initialized'); }
  await evaluate('window.__krusty.ready');
  const loadedAt = await evaluate('performance.now()');
  await sleep(400);
  const shot = async name => { const r = await send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: true, fromSurface: true}); writeFileSync(join(outDir, name), Buffer.from(r.data, 'base64')); };
  results.push({test: 'initial', value: await evaluate('window.__krusty.metrics()')});
  results.push({test: 'timing', value: await evaluate('(()=>{const n=performance.getEntriesByType("navigation")[0]||{};const rs=performance.getEntriesByType("resource").map(r=>({name:r.name.split("/").pop(),duration:+r.duration.toFixed(0),transfer:+r.transferSize||0,decoded:+r.decodedBodySize||0}));return {dcl:+(n.domContentLoadedEventEnd||0).toFixed(0),load:+(n.loadEventEnd||0).toFixed(0),now:+performance.now().toFixed(0),resources:rs}})()')});
  await shot('fast_01_quarter.png');
  await evaluate('window.__krusty.set({mode:"full"})');
  await sleep(600); await shot('fast_02_full.png');
  results.push({test: 'full', value: await evaluate('window.__krusty.metrics()')});
  await evaluate('window.__krusty.set({mode:"half",slice:12.5006})');
  await sleep(600); await shot('fast_03_half_slice.png');
  results.push({test: 'half', value: await evaluate('window.__krusty.metrics()')});
  await evaluate('document.querySelector("[data-preset=core]").click()');
  await evaluate('window.__krusty.set({mode:"quarter",slice:49.1414})');
  await sleep(500); await shot('fast_04_core.png');
  await evaluate('document.querySelector("[data-preset=all]").click()');
  await evaluate('window.__krusty.set({mode:"quarter",slice:49.1414,selected:null,isolate:false,azimuth:45,elevation:26,zoom:1})');
  await sleep(400);
  // picking regression: same probe grid as the original QA
  results.push({test: 'picking', value: await evaluate('(()=>{const c=document.querySelector("canvas"),hits=[];for(let y=.3;y<=.7;y+=.1)for(let x=.3;x<=.7;x+=.1){const id=window.__krusty.pick(x*c.clientWidth,y*c.clientHeight);if(id!==null)hits.push(id)}return [...new Set(hits)]})()')});
  await evaluate('document.querySelector("#theme").click()');
  await sleep(400); await shot('fast_05_dark.png');
  await evaluate('document.querySelector("#theme").click()');
  await send('Emulation.setDeviceMetricsOverride', {width: 390, height: 844, deviceScaleFactor: 1, mobile: true});
  await sleep(400); await shot('fast_06_mobile.png');
  results.push({test: 'mobile', value: await evaluate('window.__krusty.metrics()')});
  const out = {url, throttle: throttle ? 4 : 1, readyMs: readyAt, perfNowAtReady: +loadedAt.toFixed(0), transferredBytes: transferred, resources: urls, results, errors};
  writeFileSync(join(outDir, throttle ? 'qa_throttle.json' : 'qa.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({throttle: out.throttle, readyMs: readyAt, transferredBytes: transferred, resources: urls, errors}, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  socket?.close(); chrome.kill(); await sleep(800);
  const r = resolve(profile);
  if (r.startsWith(resolve(tmpdir()) + sep) && r.includes('krusty-fast-qa-')) { try { rmSync(r, {recursive: true, force: true}); } catch {} }
}
