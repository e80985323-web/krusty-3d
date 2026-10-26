// Quantisation experiment: how small can the quarter payload get while KEEPING normals?
// Usage: node tools/quant_experiment.mjs <source KRUSTY_3D.html> [mode=quarter]
import {readFileSync} from 'node:fs';
import {inflateSync, gzipSync} from 'node:zlib';

const src = process.argv[2];
const mode = process.argv[3] || 'quarter';
const html = readFileSync(src, 'utf8');
const s0 = html.indexOf('const SCENE=');
const s1 = html.indexOf(';\nconst COLORS=', s0);
const scene = JSON.parse(html.slice(s0 + 'const SCENE='.length, s1));
const packet = scene.packets[mode];
const raw = inflateSync(Buffer.from(packet.data, 'base64'));
const n = packet.vertices;

const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
for (let v = 0; v < n; v++) {
  pos[v * 3] = raw.readFloatLE(v * 24);
  pos[v * 3 + 1] = raw.readFloatLE(v * 24 + 4);
  pos[v * 3 + 2] = raw.readFloatLE(v * 24 + 8);
  nor[v * 3] = raw.readFloatLE(v * 24 + 12);
  nor[v * 3 + 1] = raw.readFloatLE(v * 24 + 16);
  nor[v * 3 + 2] = raw.readFloatLE(v * 24 + 20);
}
const mb = (b) => (b / 1048576).toFixed(2) + ' MB';
console.log(`mode=${mode} verts=${n}  raw f32x6 = ${mb(n * 24)}`);

// ---- quantisation error helpers ----
function angErr(a, b) { // a,b unit Float32Array triples
  let max = 0, sum = 0;
  for (let v = 0; v < n; v++) {
    let d = a[v * 3] * b[v * 3] + a[v * 3 + 1] * b[v * 3 + 1] + a[v * 3 + 2] * b[v * 3 + 2];
    d = Math.min(1, Math.max(-1, d));
    const e = Math.acos(d) * 180 / Math.PI;
    if (e > max) max = e; sum += e;
  }
  return {max, mean: sum / n};
}
function normalsInt8() {
  const q = new Int8Array(n * 3);
  for (let i = 0; i < n * 3; i++) q[i] = Math.max(-127, Math.min(127, Math.round(nor[i] * 127)));
  const back = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    let x = q[v * 3] / 127, y = q[v * 3 + 1] / 127, z = q[v * 3 + 2] / 127;
    const l = Math.hypot(x, y, z) || 1;
    back[v * 3] = x / l; back[v * 3 + 1] = y / l; back[v * 3 + 2] = z / l;
  }
  return {q, err: angErr(nor, back)};
}
function normalsOct16() { // octahedral, 16-bit per axis
  const q = new Int16Array(n * 2);
  const back = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    let x = nor[v * 3], y = nor[v * 3 + 1], z = nor[v * 3 + 2];
    const l1 = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
    let px = x / l1, py = y / l1;
    if (z < 0) {
      const ox = (1 - Math.abs(py)) * Math.sign(px || 1);
      const oy = (1 - Math.abs(px)) * Math.sign(py || 1);
      px = ox; py = oy;
    }
    q[v * 2] = Math.max(-32767, Math.min(32767, Math.round(px * 32767)));
    q[v * 2 + 1] = Math.max(-32767, Math.min(32767, Math.round(py * 32767)));
    let ax = q[v * 2] / 32767, ay = q[v * 2 + 1] / 32767;
    let az = 1 - Math.abs(ax) - Math.abs(ay);
    if (az < 0) {
      const ox = (1 - Math.abs(ay)) * Math.sign(ax || 1);
      const oy = (1 - Math.abs(ax)) * Math.sign(ay || 1);
      ax = ox; ay = oy;
    } else az = 0;
    // rebuild: oct decode gives (ax,ay,az)+az complement
    let X = ax, Y = ay, Z = 1 - Math.abs(ax) - Math.abs(ay);
    if (Z < 0) { const ox = (1 - Math.abs(Y)) * Math.sign(X || 1), oy = (1 - Math.abs(X)) * Math.sign(Y || 1); X = ox; Y = oy; }
    // inside negative hemisphere
    const denom = (x + y + z) < 0 ? -1 : 1;
    X *= denom; Y *= denom; Z *= denom;
    const l = Math.hypot(X, Y, Z) || 1;
    back[v * 3] = X / l; back[v * 3 + 1] = Y / l; back[v * 3 + 2] = Z / l;
  }
  return {q, err: angErr(nor, back)};
}
function gz(buf, label) { const g = gzipSync(buf, {level: 9}); console.log(`${label}: gzip9 = ${mb(g.length)} (raw ${mb(buf.length)})`); return g.length; }

const i8 = normalsInt8();
const oc = normalsOct16();
console.log(`int8 normal angular error: mean=${i8.err.mean.toFixed(3)}° max=${i8.err.max.toFixed(3)}°`);
console.log(`oct16 normal angular error: mean=${oc.err.mean.toFixed(3)}° max=${oc.err.max.toFixed(3)}°`);

// V0 pos only f32
{ const b = Buffer.alloc(n * 12); for (let v = 0; v < n; v++) { b.writeFloatLE(pos[v * 3], v * 12); b.writeFloatLE(pos[v * 3 + 1], v * 12 + 4); b.writeFloatLE(pos[v * 3 + 2], v * 12 + 8); } gz(b, 'V0 pos-f32               '); }
// V1 pos f32 + n int8 (pad to 16)
{ const b = Buffer.alloc(n * 16); for (let v = 0; v < n; v++) { b.writeFloatLE(pos[v * 3], v * 16); b.writeFloatLE(pos[v * 3 + 1], v * 16 + 4); b.writeFloatLE(pos[v * 3 + 2], v * 16 + 8); b.writeInt8(i8.q[v * 3], v * 16 + 12); b.writeInt8(i8.q[v * 3 + 1], v * 16 + 13); b.writeInt8(i8.q[v * 3 + 2], v * 16 + 14); } gz(b, 'V1 pos-f32 + nor-i8      '); }
// V2 pos int16 global + n int8 (stride 12)
{
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < n; v++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pos[v * 3 + k]); hi[k] = Math.max(hi[k], pos[v * 3 + k]); }
  const q = new Int16Array(n * 3);
  for (let v = 0; v < n; v++) for (let k = 0; k < 3; k++) {
    const t = (pos[v * 3 + k] - lo[k]) / (hi[k] - lo[k]);
    q[v * 3 + k] = Math.max(-32767, Math.min(32767, Math.round(t * 65534 - 32767)));
  }
  const b = Buffer.alloc(n * 12);
  for (let v = 0; v < n; v++) { for (let k = 0; k < 3; k++) b.writeInt16LE(q[v * 3 + k], v * 12 + k * 2); b.writeInt8(i8.q[v * 3], v * 12 + 6); b.writeInt8(i8.q[v * 3 + 1], v * 12 + 7); b.writeInt8(i8.q[v * 3 + 2], v * 12 + 8); }
  gz(b, 'V2 pos-i16-global+nor-i8 ');
  console.log(`   pos quant step: ${((hi[0]-lo[0])/65534).toExponential(2)} cm (x), bounds=${lo.map(x=>x.toFixed(2))} .. ${hi.map(x=>x.toFixed(2))}`);
}
// V3 pos f32 + nor oct16 (stride 16)
{ const b = Buffer.alloc(n * 16); for (let v = 0; v < n; v++) { b.writeFloatLE(pos[v * 3], v * 16); b.writeFloatLE(pos[v * 3 + 1], v * 16 + 4); b.writeFloatLE(pos[v * 3 + 2], v * 16 + 8); b.writeInt16LE(oc.q[v * 2], v * 16 + 12); b.writeInt16LE(oc.q[v * 2 + 1], v * 16 + 14); } gz(b, 'V3 pos-f32 + nor-oct16   '); }
// V4 original f32x6
{ const b = Buffer.alloc(n * 24); for (let v = 0; v < n; v++) { for (let k = 0; k < 3; k++) { b.writeFloatLE(pos[v * 3 + k], v * 24 + k * 4); b.writeFloatLE(nor[v * 3 + k], v * 24 + 12 + k * 4); } } gz(b, 'V4 pos-f32 + nor-f32 (orig)'); }