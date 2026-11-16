/* 线上验收：https://kong8la.com/plant1/ 四个页面 + SW 作用域 + 出声 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const root = path.join(dir, '..');
const shotDir = path.join(root, 'shots');
fs.mkdirSync(shotDir, { recursive: true });
const BASE = (process.env.PLANT1_BASE || 'https://kong8la.com/plant1/').replace(/\/?$/, '/');
const port = 9355;
const profile = path.join(root, '.chrome-live');
try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { }

const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
  '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1600,1000', 'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let page;
for (let i = 0; i < 80 && !page; i++) {
  try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) { }
  if (!page) await sleep(150);
}
if (!page) throw new Error('chrome 未启动');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
  else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text + ' @ ' + (m.params.entry.url || ''));
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text);
  return r.result.value;
};
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(shotDir, name), Buffer.from(s.data, 'base64'));
};

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');

const report = {};

await send('Page.navigate', { url: BASE });
await sleep(1600);
report.landing = await ev(`(() => ({
  title: document.title,
  h1: (document.querySelector('h1') || {}).textContent,
  imgs: [...document.images].length,
  imgsOk: [...document.images].every(i => i.complete && i.naturalWidth > 0),
  nav: [...document.querySelectorAll('.links a')].map(a => a.textContent)
}))()`);
await shot('live-landing.png');

await send('Page.navigate', { url: BASE + 'play/' });
await sleep(1800);
report.playBoot = await ev(`({ hasPLANT1: !!window.PLANT1, knobs: document.querySelectorAll('.knob').length, errors: window.__errs || [] })`);
await ev(`(async () => { PLANT1.press(60); return 1; })()`);
await sleep(1500);
report.playAudio = await ev(`PLANT1.status()`);
await ev(`(async () => { PLANT1.release(60); return 1; })()`);
await sleep(700);
report.playSW = await ev(`navigator.serviceWorker.getRegistrations().then(r => r.map(x => x.scope))`);
await shot('live-play.png');

await send('Page.navigate', { url: BASE + 'install/' });
await sleep(1300);
report.install = await ev(`({
  marks: [...document.querySelectorAll('#rows .mark')].map(m => m.textContent).join(''),
  logLines: document.querySelectorAll('#log div').length
})`);

await send('Page.navigate', { url: BASE + 'flash/' });
await sleep(1400);
report.flash = await ev(`({ booted: window.__flashBooted === true, hasApi: !!window.PLANT1_FLASH })`);
report.flashFetchVendor = await ev(`fetch('vendor/fm1ota.js').then(r => r.status)`);

console.log(JSON.stringify({ ...report, errors: errors.length ? errors : 'none' }, null, 2));

ws.close();
chrome.kill();
process.exit(errors.length ? 1 : 0);
