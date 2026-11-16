/* 线上刷写页验收：官方构建能否载入并解析 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const root = path.join(dir, '..');
const BASE = (process.env.PLANT1_BASE || 'https://kong8la.com/plant1/').replace(/\/?$/, '/');
const port = 9366;
const profile = path.join(root, '.chrome-flash');
try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { }

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
  '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--window-size=1200,1200', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let page;
for (let i = 0; i < 80 && !page; i++) {
  try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch (e) { }
  if (!page) await sleep(150);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
  else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text);
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text);
  return r.result.value;
};
await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Page.navigate', { url: BASE + 'flash/' });
await sleep(1600);

const boot = await ev(`({
  booted: window.__flashBooted === true,
  meta: document.querySelector('#officialMeta').textContent,
  btnDisabled: document.querySelector('#btnOfficial').disabled
})`);

const loaded = await ev(`(async () => {
  document.querySelector('#btnOfficial').click();
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 100));
    const t = document.querySelector('#officialMeta').textContent;
    if (t.includes('已载入') || t.includes('失败')) return { meta: t, state: window.PLANT1_FLASH.state(), sha: document.querySelector('#vSha').textContent, product: document.querySelector('#vProduct').textContent };
  }
  return { timeout: true, meta: document.querySelector('#officialMeta').textContent };
})()`);

const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(root, 'shots', 'flash-official.png'), Buffer.from(shot.data, 'base64'));

console.log(JSON.stringify({ boot, loaded, errors: errors.length ? errors : 'none' }, null, 2));
ws.close(); chrome.kill();
process.exit(errors.length || !loaded.product ? 1 : 0);
