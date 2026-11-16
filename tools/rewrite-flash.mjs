import fs from 'node:fs';

const p = 'C:/Users/sunin/Documents/deepseek-harness/default-workspace/fm1-phase-plant/flash/index.html';
let s = fs.readFileSync(p, 'utf8');

/* ---- 1. the markup of section 1 ---- */
const oldSection = s.slice(s.indexOf('  <section class="card">\n    <h2><span class="dot"></span>1 · 选择固件包'),
  s.indexOf('  <section class="card">\n    <h2><span class="dot" style="background:#a78bfa'));
if (!oldSection) throw new Error('section 1 not found');
const newSection = `  <section class="card">
    <h2><span class="dot"></span>1 · 固件<span class="step">AUTO</span></h2>
    <div class="buildinfo" id="official">
      <div class="buildinfo-h">
        <b id="fwName">PLANT-1</b>
        <span id="officialMeta">读取中…</span>
      </div>
      <div class="buildinfo-b">
        <code id="officialSha">—</code>
        <span class="status" id="fwState">校验中…</span>
      </div>
    </div>
    <details class="alt">
      <summary>或使用电脑上的 .fwsc 文件</summary>
      <div class="drop" id="drop" style="margin-top:10px">
        <b>把 .fwsc 拖到这里，或点击选择</b>
        <span>Golf / Zombie / fm1-dock / OG Synth 等社区固件，或恢复原厂用的包</span>
      </div>
      <input type="file" id="file" accept=".fwsc,application/octet-stream" hidden />
    </details>
    <dl class="kv" id="kv">
      <dt>包身份</dt><dd id="vProduct">—</dd>
      <dt>文件大小</dt><dd id="vSize">—</dd>
      <dt>逻辑镜像</dt><dd id="vImage">—</dd>
      <dt>SHA-256</dt><dd id="vSha">—</dd>
      <dt>加载器</dt><dd id="vLoader">—</dd>
    </dl>
    <div class="msg" id="pkgMsg"></div>
  </section>

`;
s = s.replace(oldSection, newSection);

/* ---- 2. the CSS for the details ---- */
s = s.replace('.buildinfo-b code{', `.alt{margin-top:10px;border-top:1px solid #14202c;padding-top:8px}
.alt summary{font-size:12px;color:var(--mut);cursor:pointer;list-style:none}
.alt summary::-webkit-details-marker{display:none}
.alt summary:hover{color:var(--txt)}
.buildinfo-b code{`);

/* ---- 3. the JS: auto-load instead of a "load" button ---- */
const jsStart = s.indexOf('/* ---------------------------------------------------------------- 1 选包 */');
const jsEnd = s.indexOf('async function loadBytes(raw, label)');
if (jsStart < 0 || jsEnd < 0) throw new Error('js block not found');
const newJs = `/* ---------------------------------------------------------------- 1 固件 */
let official = null;

/* 站点构建时内联的 flash/meta.js；没有就用 downloads/firmware.json 兜底（本地开发） */
async function bootFirmware() {
  let m = window.PLANT1_FW || null;
  if (!m) {
    try {
      const r = await fetch('../downloads/firmware.json', { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      m = await r.json();
    } catch (e) {
      $('officialMeta').textContent = '没有固件信息';
      log('读取固件信息失败：' + e.message, 'w');
      return;
    }
  }
  official = m;
  $('fwName').textContent = m.name;
  $('officialMeta').textContent = 'v' + m.version + ' · ' + m.product + ' · ' + bytes(m.bytes);
  $('officialSha').textContent = 'sha256 ' + m.sha256;
  $('fwState').textContent = '下载并校验中…';
  try {
    const r = await fetch('../downloads/' + m.file, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const raw = new Uint8Array(await r.arrayBuffer());
    const sha = hex(await crypto.subtle.digest('SHA-256', raw));
    if (sha !== m.sha256) throw new Error('SHA-256 不匹配（下载损坏或被改过）');
    await loadBytes(raw, m.file);
    $('fwState').innerHTML = '<span class="ok">已校验</span>';
    log('固件就绪：' + m.name + ' ' + m.version + ' · ' + m.product, 's');
  } catch (e) {
    $('fwState').innerHTML = '<span class="bad">加载失败</span>';
    $('pkgMsg').className = 'msg show err';
    $('pkgMsg').innerHTML = '<b>固件加载失败：</b>' + e.message;
    log('固件加载失败：' + e.message, 'e');
  }
}
bootFirmware();

`;
s = s.slice(0, jsStart) + newJs + s.slice(jsEnd);

/* ---- 4. the write button reads "安装" ---- */
s = s.split('>写入固件<').join('>安装固件<');
s = s.split('3 · 写入').join('3 · 安装');
s = s.split("$('writeStatus').textContent = '等待固件包';").join("$('writeStatus').textContent = '等待固件';");
s = s.split("if (!state.image) $('writeStatus').textContent = '等待固件';").join("if (!state.image) $('writeStatus').textContent = '等待固件';");

/* ---- 5. the meta.js script tag ---- */
s = s.replace('<script type="module">', '<script src="meta.js"></script>\n<script type="module">');

fs.writeFileSync(p, s, 'utf8');
console.log('rewritten', s.length);
