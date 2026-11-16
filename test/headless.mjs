/* 无头 Chrome 验收：file:// 与 http:// 两条链路 · 控制台错误 · 自检 · 交互 · 真实出声 · 截图 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const root = path.join(dir, '..');
const fileUrl = 'file:///' + path.join(root, 'play', 'index.html').replace(/\\/g, '/');
const shotDir = path.join(root, 'shots');
fs.mkdirSync(shotDir, { recursive: true });
const port = 9333;
const profile = path.join(root, '.chrome-profile');
try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { }

// 本地静态服务（用于测试 AudioWorklet 路径）
const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const p = path.join(root, urlPath);
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end('nope'); return; }
    const ext = path.extname(p).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
      '.webmanifest': 'application/manifest+json', '.json': 'application/json'
    };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const httpUrl = 'http://127.0.0.1:' + server.address().port + '/play/index.html';
const siteUrl = 'http://127.0.0.1:' + server.address().port + '/';

const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=' + port,
  '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
  '--autoplay-policy=no-user-gesture-required',
  '--window-size=1600,1000', 'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getTargets() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await r.json();
      const page = list.find(t => t.type === 'page');
      if (page) return page;
    } catch (e) { }
    await sleep(150);
  }
  throw new Error('chrome 未启动');
}

const page = await getTargets();
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
let errors = [];

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
  } else if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map(a => a.value !== undefined ? a.value : a.description).join(' ');
    logs.push(msg.params.type + ': ' + text);
    if (msg.params.type === 'error') errors.push(text);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    errors.push((d.exception && d.exception.description) || d.text);
  } else if (msg.method === 'Log.entryAdded') {
    const e = msg.params.entry;
    if (e.level === 'error' && !/favicon/.test(e.text || '')) errors.push(e.text + ' @ ' + (e.url || ''));
  }
});
await new Promise(r => ws.addEventListener('open', r));

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
  return r.result.value;
}

async function screenshot(name) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(shotDir, name), Buffer.from(shot.data, 'base64'));
}

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: 'window.__errs=[];window.addEventListener("error",function(e){window.__errs.push(String(e.message)+" @"+(e.filename||"")+":"+(e.lineno||0));});window.addEventListener("unhandledrejection",function(e){window.__errs.push("rejection: "+String(e.reason&&e.reason.message||e.reason));});'
});

const report = {};

/* ---------------------------------------------------------------- file:// */
await send('Page.navigate', { url: fileUrl });
await sleep(1500);

report.boot = await evalJs(`(() => {
  const q = s => document.querySelector(s);
  return {
    errs: window.__errs || [],
    title: document.title,
    hasPLANT1: !!window.PLANT1,
    params: window.PLANT1 && window.PLANT1.params,
    presets: window.PLANT1 && window.PLANT1.presets.length,
    knobs: document.querySelectorAll('.knob').length,
    gens: document.querySelectorAll('.gen').length,
    fxs: document.querySelectorAll('.fx').length,
    keys: document.querySelectorAll('.wkey').length + '+' + document.querySelectorAll('.bkey').length,
    matrixRows: document.querySelectorAll('.mrow').length,
    presetName: q('#presetName') && q('#presetName').textContent
  };
})()`);

report.offline = await evalJs(`Array.from({length: PLANT1.presets.length}, (_, i) => PLANT1.offline(i, 2.2, 60))`);
report.offlineBad = report.offline.filter(r => r.nan > 0 || r.peak > 1.01 || r.rms < 5e-4);

report.debug = await evalJs(`(() => {
  const r = s => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().top) + '/' + Math.round(e.getBoundingClientRect().height) : null; };
  return {
    level: PLANT1.patch().params['gen0.level'],
    cut: PLANT1.patch().params['gen0.cut'],
    knobVals: [...document.querySelectorAll('.gen .kval')].slice(0, 4).map(k => k.textContent),
    main: r('main'), fx: r('.fxrow'), keys: r('.keys'), kbd: r('#kbd'),
    bodyH: innerHeight
  };
})()`);

report.interact = await evalJs(`(() => {
  const before = document.querySelector('#presetName').textContent;
  document.querySelector('#pNext').click();
  const after = document.querySelector('#presetName').textContent;
  PLANT1.addMod('lfo1', 'gen0.cut');
  PLANT1.setParam('gen0.level', 0.4);
  const gen0Params = [...document.querySelectorAll('.gen')][0].querySelectorAll('.knob');
  const fxTypes = [...document.querySelectorAll('.fx .sel')].slice(0, 5).map(s => s.value + ':' + s.selectedOptions[0].text);
  return {
    before, after,
    rows: document.querySelectorAll('.mrow').length,
    level: PLANT1.patch().params['gen0.level'],
    gen0KnobParams: [...gen0Params].map(k => k.dataset.param),
    fxTypes
  };
})()`);

/* 真实出声：file:// → ScriptProcessor 回退 */
await evalJs(`(async () => { PLANT1.press(60); return 1; })()`);
await sleep(1400);
report.audioFile = await evalJs(`PLANT1.status()`);
report.audioFileScope = await evalJs(`(() => {
  const a = PLANT1.status();
  return { voices: a.voices, meter: +a.meter.toFixed(4) };
})()`);
await evalJs(`(async () => { PLANT1.release(60); return 1; })()`);
await sleep(300);
await screenshot('file-mode.png');

/* ---------------------------------------------------------------- http:// */
await send('Page.navigate', { url: httpUrl });
await sleep(1500);
report.httpBoot = await evalJs(`({ errs: window.__errs || [], knobs: document.querySelectorAll('.knob').length })`);
await evalJs(`(async () => { PLANT1.press(60); return 1; })()`);
await sleep(1400);
report.audioHttp = await evalJs(`PLANT1.status()`);
await evalJs(`(async () => { PLANT1.release(60); return 1; })()`);
await sleep(200);
await screenshot('main.png');

/* 窄屏与音色截图 */
await evalJs(`(() => { document.querySelectorAll('#pName').forEach(b => b.click()); document.body.click(); return 1; })()`);
await sleep(200);
await evalJs(`(() => { for (let i = 0; i < 3; i++) document.querySelector('#pNext').click(); return 1; })()`);
await evalJs(`(async () => { PLANT1.press(48); PLANT1.press(52); PLANT1.press(55); return 1; })()`);
await sleep(700);
await screenshot('preset-saw.png');
await evalJs(`(async () => { PLANT1.release(48); PLANT1.release(52); PLANT1.release(55); return 1; })()`);

await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(500);
await screenshot('narrow.png');
await send('Emulation.clearDeviceMetricsOverride');

/* Service Worker：http 下的离线缓存 */
await sleep(600);
report.sw = await evalJs(`navigator.serviceWorker.getRegistrations().then(r => ({ count: r.length, scopes: r.map(x => x.scope) }))`);

/* ------------------------------------------------------------- 落地页 */
await send('Page.navigate', { url: siteUrl });
await sleep(900);
report.landing = await evalJs(`(() => ({
  errs: window.__errs || [],
  h1: document.querySelector('h1') && document.querySelector('h1').textContent.trim(),
  links: [...document.querySelectorAll('a')].map(a => a.getAttribute('href')).filter(Boolean).slice(0, 10),
  imgLoaded: [...document.images].every(i => i.complete && i.naturalWidth > 0),
  title: document.title
}))()`);
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
await sleep(300);
await screenshot('landing.png');
await send('Emulation.clearDeviceMetricsOverride');

/* ------------------------------------------------------------- 安装页 */
await send('Page.navigate', { url: siteUrl + 'install/index.html' });
await sleep(1200);
report.install = await evalJs(`(() => ({
  errs: window.__errs || [],
  rows: document.querySelectorAll('#rows .row').length,
  logLines: document.querySelectorAll('#log div').length,
  installBtn: !!document.querySelector('#btnInstall'),
  midiBtn: !!document.querySelector('#btnMidi'),
  marks: [...document.querySelectorAll('#rows .mark')].map(m => m.textContent).join('')
}))()`);
await evalJs(`(() => { document.querySelector('#btnSaveLog'); return 1; })()`);
await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 1000, deviceScaleFactor: 1, mobile: false });
await sleep(300);
await screenshot('install.png');
await send('Emulation.clearDeviceMetricsOverride');

console.log(JSON.stringify({
  boot: { ...report.boot, offline: undefined },
  offlineBad: report.offlineBad,
  offlineSummary: report.offline.map(r => ({ name: r.name, peak: +r.peak.toFixed(3), rms: +r.rms.toFixed(3) })),
  interact: report.interact,
  debug: report.debug,
  audioFile: report.audioFile,
  audioHttp: report.audioHttp,
  sw: report.sw,
  landing: report.landing,
  install: report.install,
  logs: logs.slice(0, 12),
  errors: errors.length ? errors : 'none'
}, null, 2));

ws.close();
chrome.kill();
server.close();
process.exit(errors.length || report.offlineBad.length || !report.audioHttp.ready ? 1 : 0);
