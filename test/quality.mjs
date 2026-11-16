/* 音质体检：直流偏置 + 正弦 patch 的起音/释音爆音检测 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const PLANT = require('../src/engine.js');
const LIB = require('../src/presets.js');
const SR = 48000;
let fail = 0;

/* 1. 各预设直流偏置 */
for (const p of LIB.PRESETS) {
  const eng = new PLANT.Engine(SR);
  eng.setPatch(Object.assign({}, PLANT.defaults(), p.params, { mods: p.mods || [] }));
  const [L] = eng.renderOffline(2, [{ t: 0.05, on: true, midi: 57 }]);
  let dc = 0;
  const a = Math.floor(0.1 * SR), b = Math.floor(1.9 * SR);
  for (let i = a; i < b; i++) dc += L[i];
  dc /= (b - a);
  const ok = Math.abs(dc) < 0.01;
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} DC ${p.en.padEnd(14)} ${dc.toExponential(1)}`);
}

/* 2. 正弦 patch：起音/释音不应有阶跃 */
function jump(eng, notes, from, width) {
  const [L] = eng.renderOffline(1.2, notes);
  let mx = 0;
  const a = Math.floor(from * SR), b = a + Math.floor(width * SR);
  for (let i = a + 1; i < b; i++) mx = Math.max(mx, Math.abs(L[i] - L[i - 1]));
  return mx;
}
const sinePatch = Object.assign(PLANT.defaults(), {
  'gen0.type': 0, 'gen0.wave': 3, 'gen0.level': 0, 'gen0.cut': 18000,
  'voice.poly': 2, 'voice.gain': 0.7,
  'env0.a': 0.01, 'env0.d': 0.4, 'env0.s': 0.7, 'env0.r': 0.25
});
sinePatch.mods = [{ src: 'env1', target: 'gen0.level', amt: 0.9 }];

{
  const eng = new PLANT.Engine(SR);
  eng.setPatch(sinePatch);
  const on = jump(eng, [{ t: 0.2, on: true, midi: 60 }], 0.2, 0.03);
  const off = jump(eng, [{ t: 0.2, on: true, midi: 60 }, { t: 0.7, on: false, midi: 60 }], 0.7, 0.03);
  const ok = on < 0.08 && off < 0.08;
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} 起音跳变 ${on.toFixed(4)} / 释音跳变 ${off.toFixed(4)}（阈值 0.08）`);
}

/* 3. 快速连击不应留下残余声部 */
{
  const eng = new PLANT.Engine(SR);
  eng.setPatch(sinePatch);
  const [L] = eng.renderOffline(2.2, [
    { t: 0.1, on: true, midi: 60 }, { t: 0.12, on: false, midi: 60 },
    { t: 0.3, on: true, midi: 62 }, { t: 0.32, on: false, midi: 62 },
    { t: 0.5, on: true, midi: 64 }, { t: 0.52, on: false, midi: 64 }
  ]);
  let s = 0;
  const a = Math.floor(1.8 * SR), b = Math.floor(2.1 * SR);
  for (let i = a; i < b; i++) s += L[i] * L[i];
  const rms = Math.sqrt(s / (b - a));
  const ok = rms < 1e-4;
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} 释音后无残余 tails rms=${rms.toExponential(1)}`);
}

console.log(fail ? `\n${fail} 项未通过` : '\n音质体检通过');
process.exit(fail ? 1 : 0);
