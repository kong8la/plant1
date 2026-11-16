/* 引擎离线验收：音高、电平、稳定性、实时率 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const PLANT = require('../src/engine.js');
const LIB = require('../src/presets.js');

const SR = 48000;
const NOTE = 60; // C4
const F0 = 261.6256;

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

function spectrum(buf, start, size) {
  const re = new Float64Array(size), im = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / size);
    re[i] = buf[start + i] * w;
  }
  fft(re, im);
  const mag = new Float64Array(size / 2);
  for (let i = 0; i < size / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

function stats(L, R) {
  let peak = 0, sum = 0, bad = 0;
  for (let i = 0; i < L.length; i++) {
    const l = L[i], r = R[i];
    if (!Number.isFinite(l) || !Number.isFinite(r)) bad++;
    const a = Math.max(Math.abs(l), Math.abs(r));
    if (a > peak) peak = a;
    sum += l * l + r * r;
  }
  return { peak, rms: Math.sqrt(sum / (L.length * 2)), bad, mono: L };
}

function rmsWindow(buf, t0, t1) {
  const a = Math.floor(t0 * SR), b = Math.min(buf.length, Math.floor(t1 * SR));
  let s = 0;
  for (let i = a; i < b; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / Math.max(1, b - a));
}

const results = [];
let fail = 0;

for (const preset of LIB.PRESETS) {
  const eng = new PLANT.Engine(SR);
  const patch = Object.assign({}, PLANT.defaults(), preset.params, { mods: preset.mods || [] });
  eng.setPatch(patch);
  const t0 = performance.now();
  const [L, R] = eng.renderOffline(3.0, [
    { t: 0.02, on: true, midi: NOTE, vel: 0.9 },
    { t: 1.6, on: false, midi: NOTE }
  ]);
  const ms = performance.now() - t0;
  const st = stats(L, R);
  const attack = rmsWindow(L, 0.02, 0.25);
  const sustain = rmsWindow(L, 1.2, 1.55);
  const tail = rmsWindow(L, 1.7, 1.75);

  // 音高：在 C4 附近找谱峰（只对单音准的预设做软判断）
  let pitchOk = null;
  if (preset.en === 'FM BASS') {
    const mag = spectrum(L, Math.floor(0.5 * SR), 16384);
    let best = 0, bi = 0;
    for (let i = 2; i < mag.length; i++) if (mag[i] > best) { best = mag[i]; bi = i; }
    const f = bi * SR / 16384;
    pitchOk = Math.abs(f - F0 / 2) < 12 || Math.abs(f - F0) < 12;
  }
  if (preset.en === 'ACID 303') {
    const mag = spectrum(L, Math.floor(0.5 * SR), 16384);
    let best = 0, bi = 0;
    for (let i = 2; i < mag.length; i++) if (mag[i] > best) { best = mag[i]; bi = i; }
    const f = bi * SR / 16384;
    pitchOk = Math.abs(f - F0 / 2) < 14;
  }

  const problems = [];
  if (st.bad) problems.push('NaN×' + st.bad);
  if (st.peak > 1.02) problems.push('peak ' + st.peak.toFixed(2));
  if (st.rms < 5e-4) problems.push('silent rms ' + st.rms.toExponential(2));
  if (st.rms > 0.6) problems.push('too loud ' + st.rms.toFixed(2));
  if (pitchOk === false) problems.push('pitch');
  if (problems.length) fail++;

  results.push({
    name: preset.en.padEnd(14), rms: st.rms.toFixed(4), peak: st.peak.toFixed(3),
    attack: attack.toFixed(4), sus: sustain.toFixed(4), tail: tail.toFixed(5),
    ms: ms.toFixed(1), ok: problems.length ? problems.join(',') : 'ok'
  });
}

console.table(results);

// 多复音 + 齐奏压力测试
const eng = new PLANT.Engine(SR);
const big = Object.assign({}, PLANT.defaults(), LIB.PRESETS.find(p => p.en === 'SUPER SAW').params, {
  mods: LIB.PRESETS.find(p => p.en === 'SUPER SAW').mods
});
eng.setPatch(big);
const t1 = performance.now();
const [L, R] = eng.renderOffline(4.0, [48, 52, 55, 59, 62, 64].map((m, i) => ({ t: 0.02 + i * 0.05, on: true, midi: m })));
const ms = performance.now() - t1;
const st = stats(L, R);
console.log(`压力: 6 声部 × 5 齐奏 × 2 发生器, 4s 渲染 ${ms.toFixed(0)}ms (实时率 ${(4000 / ms).toFixed(1)}×), peak ${st.peak.toFixed(3)}, rms ${st.rms.toFixed(3)}`);
if (st.bad || st.peak > 1.02) fail++;

console.log(fail === 0 ? '\n全部通过' : `\n失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
