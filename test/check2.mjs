/* 进阶验收：立体声宽度、调制是否真的在动、复音上限、调性音高 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const PLANT = require('../src/engine.js');
const LIB = require('../src/presets.js');

const SR = 48000;
let fail = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (extra ? '  ' + extra : ''));
  if (!cond) fail++;
};

function render(presetName, seconds, notes, tweak) {
  const p = LIB.PRESETS.find(x => x.en === presetName);
  const eng = new PLANT.Engine(SR);
  eng.setPatch(Object.assign({}, PLANT.defaults(), p.params, tweak || {}, { mods: (tweak && tweak.mods) || p.mods }));
  return { eng, out: eng.renderOffline(seconds, notes) };
}

/* 1. 立体声宽度 */
{
  const { out } = render('SUPER SAW', 2, [{ t: 0.02, on: true, midi: 60 }, { t: 1.8, on: false, midi: 60 }]);
  const [L, R] = out;
  let num = 0, dl = 0, dr = 0;
  const a = Math.floor(0.4 * SR), b = Math.floor(1.4 * SR);
  for (let i = a; i < b; i++) { num += L[i] * R[i]; dl += L[i] * L[i]; dr += R[i] * R[i]; }
  const corr = num / Math.sqrt(dl * dr + 1e-12);
  ok('超锯齿左右声道有宽度', corr < 0.98, 'corr=' + corr.toFixed(3));
}

/* 2. LFO 调制：同一 patch 下 amp=1 vs amp=0 的频谱重心波动 */
{
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
  function centroid(buf, start, size) {
    const re = new Float64Array(size), im = new Float64Array(size);
    for (let i = 0; i < size; i++) re[i] = buf[start + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / size));
    fft(re, im);
    let num = 0, den = 0;
    for (let i = 1; i < size / 2; i++) {
      const m = Math.hypot(re[i], im[i]);
      num += m * i * SR / size; den += m;
    }
    return den > 1e-9 ? num / den : 0;
  }
  const mk = (amp) => Object.assign(PLANT.defaults(), {
    'gen0.type': 0, 'gen0.wave': 0, 'gen0.level': 0,
    'gen0.cut': 700, 'gen0.ftype': 1, 'gen0.res': 0.5,
    'voice.unison': 1, 'flt.on': 0,
    'env0.a': 0.01, 'env0.d': 0.8, 'env0.s': 1, 'env0.r': 0.2,
    'lfo0.rate': 2, 'lfo0.shape': 0, 'lfo0.amp': amp,
    mods: [{ src: 'env1', target: 'gen0.level', amt: 0.8 },
           { src: 'lfo1', target: 'gen0.cut', amt: 0.9 }]
  });
  const spread = (amp) => {
    const eng = new PLANT.Engine(SR);
    eng.setPatch(mk(amp));
    const [L] = eng.renderOffline(2.4, [{ t: 0.02, on: true, midi: 60 }]);
    const vals = [];
    for (let t = 0.5; t < 2.2; t += 0.12) vals.push(centroid(L, Math.floor(t * SR), 8192));
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    return { d: Math.sqrt(vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / vals.length) / mean, mean };
  };
  const on = spread(1), off = spread(0);
  ok('LFO 确实在调制（对比 amp=0）', on.d > off.d * 3 + 0.05,
    'with=' + on.d.toFixed(3) + ' off=' + off.d.toFixed(3) + ' centroid=' + on.mean.toFixed(0) + 'Hz');
}

/* 3. 复音上限 */
{
  const { eng } = render('SUPER SAW', 1.2, []);
  const p = LIB.PRESETS.find(x => x.name === '超锯齿');
  eng.setPatch(Object.assign({}, PLANT.defaults(), p.params, { mods: p.mods }));
  for (let i = 0; i < 12; i++) eng.noteOn(48 + i, 0.9);
  const L = new Float32Array(256), R = new Float32Array(256);
  for (let k = 0; k < 20; k++) eng.process(L, R, 256);
  const poly = PLANT.PARAMS['voice.poly'].def;
  ok('复音数不超过设定', (eng.activeVoices || 0) <= poly, 'active=' + eng.activeVoices + ' poly=' + poly);
}

/* 4. 音高：初始化预设的基频应接近 C4 */
{
  const { out } = render('INIT', 1.2, [{ t: 0.02, on: true, midi: 60 }]);
  const [L] = out;
  const a = Math.floor(0.3 * SR), n = 16384;
  let zc = 0;
  for (let i = a; i < a + n; i++) if ((L[i] >= 0) !== (L[i + 1] >= 0)) zc++;
  const f = zc / 2 / (n / SR);
  ok('初始化的基频约 261Hz', Math.abs(f - 261.6) < 12, 'f=' + f.toFixed(1) + 'Hz');
}

/* 5. 效果器：混响应延长尾音 */
{
  const base = render('PLASTIC PLUCK', 2.5, [{ t: 0.02, on: true, midi: 60 }]);
  const wet = render('PLASTIC PLUCK', 2.5, [{ t: 0.02, on: true, midi: 60 }], {
    'fx3.on': 1, 'fx3.type': 5, 'fx3.p1': 0.9, 'fx3.p2': 0.3, 'fx3.mix': 0.9
  });
  const tail = (out) => {
    const [L] = out; let s = 0;
    const a = Math.floor(1.2 * SR), b = Math.floor(1.8 * SR);
    for (let i = a; i < b; i++) s += L[i] * L[i];
    return Math.sqrt(s / (b - a));
  };
  ok('混响延长尾音', tail(wet.out) > tail(base.out) * 2, 'dry=' + tail(base.out).toExponential(2) + ' wet=' + tail(wet.out).toExponential(2));
}

/* 6. tempo / macro 改值立刻生效（影响编译结果） */
{
  const eng = new PLANT.Engine(SR);
  eng.setPatch(PLANT.defaults());
  eng.setParam('tempo', 60);
  eng.setParam('macro.val', 1);
  ok('tempo/macro 立即生效', eng.c.tempo === 60 && eng.c.macro === 1, 'tempo=' + eng.c.tempo + ' macro=' + eng.c.macro);
}

/* 7. panic 之后不应残留效果器尾音 */
{
  const p = LIB.PRESETS.find(x => x.name === '黑暗合唱');
  const eng = new PLANT.Engine(SR);
  eng.setPatch(Object.assign({}, PLANT.defaults(), p.params, { mods: p.mods }));
  const L = new Float32Array(128), R = new Float32Array(128);
  eng.noteOn(60, 0.9);
  for (let i = 0; i < 300; i++) eng.process(L, R, 128);
  eng.allOff();
  for (let i = 0; i < 400; i++) eng.process(L, R, 128);
  let peak = 0;
  for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  ok('panic 后尾音已清', peak < 0.02, 'residual=' + peak.toExponential(2));
}

console.log(fail ? '\n失败 ' + fail + ' 项' : '\n进阶验收通过');
process.exit(fail ? 1 : 0);
