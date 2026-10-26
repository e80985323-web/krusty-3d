// Build the "fast" KRUSTY 3D page:
//  - geometry packets move out of the HTML into data/<mode>.bin.gz
//  - positions stay float32 (byte-identical to the original packets); normals are
//    re-quantised to int8 (mean error 0.06 deg, max 0.25 deg) so 12 of 24 bytes/vertex survive
//  - the page fetches only the packet it needs (default: quarter) with a live progress readout
//  - shading code is untouched: WebGL normalises the int8 attribute for us
// Usage: node tools/build_fast.mjs <source KRUSTY_3D.html> <repo dir>
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {inflateSync, gzipSync} from 'node:zlib';
import {resolve, join} from 'node:path';

const srcPath = resolve(process.argv[2] || '');
const outDir = resolve(process.argv[3] || '.');
if (!srcPath || !outDir) { console.error('usage: node tools/build_fast.mjs <source KRUSTY_3D.html> <repo dir>'); process.exit(2); }

const html = readFileSync(srcPath, 'utf8');
const sha = h => createHash('sha256').update(h).digest('hex');
console.log('source:', srcPath, 'bytes:', html.length.toLocaleString('en-US'), 'sha256:', sha(html));

const SCENE_HEAD = 'const SCENE=';
const SCENE_TAIL = ';\nconst COLORS=';
const s0 = html.indexOf(SCENE_HEAD);
const s1 = html.indexOf(SCENE_TAIL, s0);
if (s0 < 0 || s1 < 0) throw new Error('cannot locate SCENE literal');
const scene = JSON.parse(html.slice(s0 + SCENE_HEAD.length, s1));

const dataDir = join(outDir, 'data');
mkdirSync(dataDir, {recursive: true});

const MB = n => (n / 1048576).toFixed(2) + ' MB';
let totalOut = 0;
const report = [];
for (const [mode, packet] of Object.entries(scene.packets)) {
  const deflated = Buffer.from(packet.data, 'base64');
  const raw = inflateSync(deflated);
  const verts = packet.vertices, inStride = 24, outStride = 16;
  if (raw.length !== verts * inStride) throw new Error(`${mode}: raw size ${raw.length} != ${verts}*24`);
  const out = Buffer.alloc(verts * outStride); // zero-filled: also gives the pad byte
  let maxAng = 0, sumAng = 0;
  for (let v = 0; v < verts; v++) {
    const i = v * inStride, o = v * outStride;
    raw.copy(out, o, i, i + 12); // position: float32 x3, verbatim
    const nx = raw.readFloatLE(i + 12), ny = raw.readFloatLE(i + 16), nz = raw.readFloatLE(i + 20);
    const qx = Math.max(-127, Math.min(127, Math.round(nx * 127)));
    const qy = Math.max(-127, Math.min(127, Math.round(ny * 127)));
    const qz = Math.max(-127, Math.min(127, Math.round(nz * 127)));
    out.writeInt8(qx, o + 12); out.writeInt8(qy, o + 13); out.writeInt8(qz, o + 14);
    // record the angular error introduced by the int8 rounding (after re-normalisation)
    const dx = qx / 127, dy = qy / 127, dz = qz / 127;
    const l = Math.hypot(dx, dy, dz) || 1;
    const d = Math.min(1, Math.max(-1, (dx * nx + dy * ny + dz * nz) / l));
    const ang = Math.acos(d) * 180 / Math.PI;
    if (ang > maxAng) maxAng = ang;
    sumAng += ang;
  }
  const packed = gzipSync(out, {level: 9});
  const file = `data/${mode}.bin.gz`;
  writeFileSync(join(outDir, file), packed);
  totalOut += packed.length;
  report.push({mode, verts, triangles: packet.triangles, parts: packet.parts.length, deflateIn: deflated.length, payloadBytes: out.length, gzOut: packed.length, normalErrMeanDeg: +(sumAng / verts).toFixed(4), normalErrMaxDeg: +maxAng.toFixed(4)});
  packet.file = file;
  packet.bytes = packed.length;
  packet.rawBytes = out.length;
  packet.format = 'pos-f32+nor-i8';
  packet.stride = outStride;
  delete packet.data;
  console.log(`${mode}: verts=${verts.toLocaleString('en-US')} old=${MB(deflated.length)} -> ${file} ${MB(packed.length)} (normal err max ${maxAng.toFixed(3)} deg)`);
}
console.log('geometry payload total:', MB(totalOut));

let out = html.slice(0, s0) + SCENE_HEAD + JSON.stringify(scene) + html.slice(s1);

// --- loader: fetch the compressed packet, stream progress, two attributes over a 16-byte stride ---
const loadOld = 'async function loadMode(mode){const token=++busy;$(\'#loading\').hidden=false;$(\'#loading\').textContent=\'载入几何…\';const meta=SCENE.packets[mode];const bytes=Uint8Array.from(atob(meta.data),c=>c.charCodeAt(0));const raw=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream(\'deflate\'))).arrayBuffer();if(token!==busy)return;const next=glx.createBuffer();glx.bindBuffer(glx.ARRAY_BUFFER,next);glx.bufferData(glx.ARRAY_BUFFER,new Float32Array(raw),glx.STATIC_DRAW);if(buffer)glx.deleteBuffer(buffer);buffer=next;packet={...meta,mode};const p=window.__program;for(const [name,offset]of [[\'aPos\',0],[\'aNormal\',12]]){const a=glx.getAttribLocation(p,name);glx.enableVertexAttribArray(a);glx.vertexAttribPointer(a,3,glx.FLOAT,false,24,offset)}$(\'#loading\').hidden=true}';
const loadNew = `async function loadMode(mode){
 const token=++busy;const meta=SCENE.packets[mode];const el=$('#loading');el.hidden=false;
 const mb=n=>{n=Math.max(0,n||0);return n>=1048576?(n/1048576).toFixed(1)+' MB':Math.round(n/1024)+' KB'};
 el.textContent='载入几何… '+mb(meta.bytes);
 let res;
 try{res=await fetch(meta.file,{credentials:'same-origin',cache:'force-cache'})}
 catch(e){el.textContent=location.protocol==='file:'?'本地双击打开无法读取几何数据（浏览器安全限制），请用本地 http 服务器或在线地址打开。':'几何数据载入失败：'+e.message+'（请检查网络后刷新）';throw e}
 if(!res.ok){el.textContent='几何数据载入失败：HTTP '+res.status+'（请刷新重试）';throw Error('HTTP '+res.status)}
 const total=+res.headers.get('content-length')||meta.bytes;
 let got=0;const chunks=[];
 const reader=res.body&&res.body.getReader?res.body.getReader():null;
 if(reader){
  for(;;){const {done,value}=await reader.read();if(done)break;chunks.push(value);got+=value.length;
   el.textContent='载入几何… '+mb(Math.min(got,total))+' / '+mb(total)}
 }else{const ab=await res.arrayBuffer();chunks.push(new Uint8Array(ab));got=ab.byteLength}
 el.textContent='解压几何…';
 const ce=(res.headers.get('content-encoding')||'').toLowerCase();
 let raw;
 if(/gzip|deflate|br/.test(ce)){
  // the host already sent it compressed and the browser decoded it for us
  const ab=new Uint8Array(got);let at=0;for(const c of chunks){ab.set(c,at);at+=c.length}
  raw=ab.buffer;
 }else{
  raw=await new Response(new Blob(chunks).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
 }
 if(token!==busy)return;
 const next=glx.createBuffer();glx.bindBuffer(glx.ARRAY_BUFFER,next);glx.bufferData(glx.ARRAY_BUFFER,new Uint8Array(raw),glx.STATIC_DRAW);
 if(buffer)glx.deleteBuffer(buffer);buffer=next;packet={...meta,mode};
 const p=window.__program;const stride=meta.stride||16;
 const ap=glx.getAttribLocation(p,'aPos');glx.enableVertexAttribArray(ap);glx.vertexAttribPointer(ap,3,glx.FLOAT,false,stride,0);
 const an=glx.getAttribLocation(p,'aNormal');if(an>=0){glx.enableVertexAttribArray(an);glx.vertexAttribPointer(an,3,glx.BYTE,true,stride,12)}
 el.hidden=true;window.__krusty.loadedAt=performance.now()}`;
if (!out.includes(loadOld)) throw new Error('loadMode source not found');
out = out.replace(loadOld, loadNew);

writeFileSync(join(outDir, 'index.html'), out);
console.log('index.html ->', MB(Buffer.byteLength(out)));
mkdirSync(join(outDir, 'tools'), {recursive: true});
writeFileSync(join(outDir, 'tools', 'build_report.json'), JSON.stringify({
  source: srcPath, sourceBytes: html.length, sourceSha256: sha(html),
  outputBytes: Buffer.byteLength(out), outputSha256: sha(out),
  payload: 'pos-f32+nor-i8 (stride 16)', payloadTotal: totalOut, packets: report,
}, null, 2));