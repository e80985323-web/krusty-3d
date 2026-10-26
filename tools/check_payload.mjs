// Verify data/<mode>.bin.gz against the original embedded packets:
//  - positions must be byte-identical to the original float32 x3
//  - int8 normals must stay within tolerance (report mean/max angle) and never point away
// Usage: node tools/check_payload.mjs <source KRUSTY_3D.html> <repo dir>
import {readFileSync} from 'node:fs';
import {inflateSync, gunzipSync} from 'node:zlib';
import {resolve, join} from 'node:path';

const src = resolve(process.argv[2]);
const dir = resolve(process.argv[3] || '.');
const html = readFileSync(src, 'utf8');
const s0 = html.indexOf('const SCENE=');
const s1 = html.indexOf(';\nconst COLORS=', s0);
const scene = JSON.parse(html.slice(s0 + 'const SCENE='.length, s1));

let bad = 0;
const TOL = 1.0; // degrees of accepted normal error
for (const [mode, packet] of Object.entries(scene.packets)) {
  const raw = inflateSync(Buffer.from(packet.data, 'base64'));
  const pay = gunzipSync(readFileSync(join(dir, 'data', `${mode}.bin.gz`)));
  const verts = packet.vertices;
  if (pay.length !== verts * 16) { console.log(`${mode}: FAIL payload size ${pay.length} != ${verts * 16}`); bad++; continue; }
  let posDiff = 0, maxAng = 0, sumAng = 0, flipped = 0;
  for (let v = 0; v < verts; v++) {
    const i = v * 24, o = v * 16;
    for (let k = 0; k < 12; k++) if (raw[i + k] !== pay[o + k]) { posDiff++; break; }
    const nx = raw.readFloatLE(i + 12), ny = raw.readFloatLE(i + 16), nz = raw.readFloatLE(i + 20);
    const qx = pay.readInt8(o + 12) / 127, qy = pay.readInt8(o + 13) / 127, qz = pay.readInt8(o + 14) / 127;
    const l = Math.hypot(qx, qy, qz) || 1;
    const dot = Math.min(1, Math.max(-1, (qx * nx + qy * ny + qz * nz) / l));
    if (dot < 0) flipped++;
    const ang = Math.acos(dot) * 180 / Math.PI;
    if (ang > maxAng) maxAng = ang;
    sumAng += ang;
  }
  const ok = posDiff === 0 && maxAng <= TOL && flipped === 0;
  if (!ok) bad++;
  console.log(`${mode}: verts=${verts} posMismatch=${posDiff} normalErrMean=${(sumAng / verts).toFixed(4)}deg normalErrMax=${maxAng.toFixed(4)}deg flipped=${flipped} -> ${ok ? 'OK' : 'FAIL'}`);
}
console.log(bad ? 'PAYLOAD CHECK FAILED' : 'PAYLOAD CHECK OK');
process.exitCode = bad ? 1 : 0;