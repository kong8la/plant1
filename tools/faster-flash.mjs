import fs from 'node:fs';
const p = 'C:/Users/sunin/Documents/deepseek-harness/default-workspace/fm1-phase-plant/flash/index.html';
let s = fs.readFileSync(p, 'utf8');
const rep = (a, b, what) => { if (!s.includes(a)) throw new Error('missing: ' + what); s = s.replace(a, b); };

/* the updater is built per attempt, so a slow retry can change the pace */
rep(`  let updater;
  try {
    const access = await getAccess();
    updater = new Updater(access, (m) => log(m), { discoveryWaitMs: 800 });
  } catch (err) {`,
`  let updater;
  const makeUpdater = async (paceMs) => {
    const access = await getAccess();
    return new Updater(access, (m) => log(m), { discoveryWaitMs: 800, paceMs });
  };
  try {
    updater = await makeUpdater(0);          /* 0: reply to every block as fast as the device asks */
  } catch (err) {`, 'updater');

/* progress: show the rate and the remaining time */
rep(`  const step = (kind, n, addr) => {
    const text = STEP_TEXT[kind] || kind;
    if (kind === 'verify') {`,
`  let t0 = 0;
  const step = (kind, n, addr) => {
    const text = STEP_TEXT[kind] || kind;
    if (kind === 'write' && !t0) t0 = Date.now();
    if (kind === 'verify') {`, 'step head');

rep(`      $('barFill').style.width = pct.toFixed(1) + '%';
      $('writeStatus').textContent = text + '… ' + pct.toFixed(0) + '%';`,
`      $('barFill').style.width = pct.toFixed(1) + '%';
      const secs = t0 ? (Date.now() - t0) / 1000 : 0;
      const kbps = secs > 0.2 ? (addr / 1024 / secs) : 0;
      const left = kbps > 0 ? Math.max(0, (total - addr) / 1024 / kbps) : 0;
      $('writeStatus').textContent = text + '… ' + pct.toFixed(0) + '%' +
        (kbps ? ' · ' + kbps.toFixed(0) + ' KB/s · 还剩 ' + left.toFixed(0) + 's' : '');`, 'write text');

/* one fast attempt, then one at a slower pace if the device stops */
rep(`  try {
    const identity = await updater.install(state.image, state.product, step);
    $('resultMsg').className = 'msg show';`,
`  let identity;
  try {
    try {
      identity = await updater.install(state.image, state.product, step);
    } catch (e) {
      const retryable = e && (e.code === 'stopped' || e.code === 'lost' || e.code === 'noloader');
      if (!retryable) throw e;
      log('快速写入失败（' + (e.code || e.message) + '），改用慢速重试一次…', 'w');
      await new Promise((r) => setTimeout(r, 800));
      t0 = 0;
      updater = await makeUpdater(8);
      identity = await updater.install(state.image, state.product, step);
    }
    $('resultMsg').className = 'msg show';`, 'retry');

fs.writeFileSync(p, s, 'utf8');
console.log('flash page pacing written');
