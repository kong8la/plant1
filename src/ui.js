/* ============================================================================
 * PLANT-1 界面层：三栏模块化面板、旋钮、拖拽调制、27 键键盘、MIDI
 * ==========================================================================*/
(function () {
  'use strict';

  var engineSrc = document.getElementById('engine-src').textContent;
  var presetSrc = document.getElementById('presets-src').textContent;
  new Function(engineSrc)();
  new Function(presetSrc)();
  var PLANT = window.PLANT;
  var PRESETS = window.PLANT_PRESETS.PRESETS;
  var P = PLANT.PARAMS;

  var $ = function (id) { return document.getElementById(id); };
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  }

  var S = {
    patch: PLANT.defaults(), mods: [], preset: 0, octave: 0,
    ctx: null, node: null, analyser: null, ready: false, starting: null,
    pending: {}, raf: 0, hold: false, held: {}, sustained: {}, voices: 0, meter: 0,
    device: null,
    meterBar: null
  };
  S.patch.mods = S.mods;

  var KNOBS = {}, SELECTS = {}, REFRESH = [];

  /* ------------------------------------------------------------ 数值格式 */
  function fmtVal(id) {
    var d = P[id], v = S.patch[id];
    if (d.kind === 'enum') return (d.values && d.values[v]) || '';
    if (d.unit === 'Hz') return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k' : Math.round(v);
    if (d.unit === 's') return v < 1 ? Math.round(v * 1000) + 'ms' : v.toFixed(2) + 's';
    if (d.unit === '¢') return Math.round(v) + '¢';
    if (d.unit === 'st') return (v > 0 ? '+' : '') + v.toFixed(1);
    if (d.kind === 'int') return String(Math.round(v));
    if (d.max - d.min <= 2) return v.toFixed(2);
    if (d.max <= 1.5) return Math.round(v * 100) + '%';
    return v.toFixed(1);
  }
  function valueFromNorm(d, n) {
    var v = PLANT.fromNorm(d, clamp(n, 0, 1));
    if (d.kind === 'int' || d.kind === 'enum') v = Math.round(v);
    return clamp(v, d.min, d.max);
  }

  /* ------------------------------------------------------------ 参数写回 */
  function setParam(id, v, silent) {
    var d = P[id];
    if (!d) return;
    v = (d.kind === 'enum' || d.kind === 'int') ? Math.round(v) : v;
    v = clamp(v, d.min, d.max);
    S.patch[id] = v;
    if (!silent) { queueParam(id, v); saveSoon(); }
    refreshParam(id);
  }
  function queueParam(id, v) {
    S.pending[id] = v;
    if (!S.raf) S.raf = requestAnimationFrame(flushParams);
  }
  function flushParams() {
    S.raf = 0;
    if (!S.node) { S.pending = {}; return; }
    for (var id in S.pending) post({ type: 'param', id: id, v: S.pending[id] });
    S.pending = {};
  }
  function post(msg) { if (S.node) S.node.port.postMessage(msg); }
  function sendPatch() {
    if (!S.node) return;
    S.patch.mods = S.mods;
    post({ type: 'patch', patch: S.patch });
  }
  function sendMods() {
    S.patch.mods = S.mods;
    if (S.node) post({ type: 'mods', mods: S.mods });
    refreshAllKnobs();
  }

  /* -------------------------------------------------------------- 音频 */
  var PROC = [
    'class PlantProcessor extends AudioWorkletProcessor {',
    '  constructor() {',
    '    super();',
    '    this.e = new PLANT.Engine(sampleRate);',
    '    this.n = 0;',
    '    this.port.onmessage = (ev) => {',
    '      const m = ev.data;',
    '      try {',
    '        if (m.type === "patch") this.e.setPatch(m.patch);',
    '        else if (m.type === "param") this.e.setParam(m.id, m.v);',
    '        else if (m.type === "mods") this.e.setMods(m.mods);',
    '        else if (m.type === "note") { if (m.on) this.e.noteOn(m.midi, m.vel); else this.e.noteOff(m.midi); }',
    '        else if (m.type === "bend") this.e.setBend(m.v);',
    '        else if (m.type === "mw") this.e.setModWheel(m.v);',
    '        else if (m.type === "at") this.e.setAftertouch(m.v);',
    '        else if (m.type === "panic") this.e.allOff();',
    '      } catch (err) { }',
    '    };',
    '  }',
    '  process(inputs, outputs) {',
    '    const out = outputs[0];',
    '    if (out && out.length) {',
    '      try { this.e.process(out[0], out[1] || out[0], out[0].length); }',
    '      catch (err) { for (let c = 0; c < out.length; c++) out[c].fill(0); }',
    '    }',
    '    if ((this.n++ & 7) === 0) this.port.postMessage({ type: "stat", voices: this.e.activeVoices || 0, meter: this.e.meter || 0 });',
    '    return true;',
    '  }',
    '}',
    'registerProcessor("plant1", PlantProcessor);'
  ].join('\n');

  function applyMsg(eng, m) {
    try {
      if (m.type === 'patch') eng.setPatch(m.patch);
      else if (m.type === 'param') eng.setParam(m.id, m.v);
      else if (m.type === 'mods') eng.setMods(m.mods);
      else if (m.type === 'note') { if (m.on) eng.noteOn(m.midi, m.vel); else eng.noteOff(m.midi); }
      else if (m.type === 'bend') eng.setBend(m.v);
      else if (m.type === 'mw') eng.setModWheel(m.v);
      else if (m.type === 'at') eng.setAftertouch(m.v);
      else if (m.type === 'panic') eng.allOff();
    } catch (err) { }
  }

  /* file:// 下浏览器禁止 blob 加载 AudioWorklet，退回复用同一引擎的 ScriptProcessor */
  function makeLocalNode(ctx) {
    var sp = ctx.createScriptProcessor(512, 0, 2);
    var eng = new PLANT.Engine(ctx.sampleRate);
    var api = {
      local: true,
      port: { postMessage: function (m) { applyMsg(eng, m); } },
      connect: function (dst) { sp.connect(dst); },
      disconnect: function () { sp.disconnect(); }
    };
    sp.onaudioprocess = function (e) {
      var L = e.outputBuffer.getChannelData(0);
      var R = e.outputBuffer.getChannelData(1);
      try { eng.process(L, R, L.length); } catch (err) { L.fill(0); R.fill(0); }
      S.voices = eng.activeVoices || 0;
      S.meter = eng.meter || 0;
    };
    return api;
  }

  function ensureAudio() {
    if (S.ctx) { if (S.ctx.state === 'suspended') S.ctx.resume(); return S.starting || Promise.resolve(); }
    if (S.starting) return S.starting;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { toast('这个浏览器不支持 Web Audio'); return Promise.resolve(); }
    S.starting = (async function () {
      var ctx = new AC({ latencyHint: 'interactive' });
      var node = null;
      if (ctx.audioWorklet && location.protocol !== 'file:') {
        try {
          var url = URL.createObjectURL(new Blob([engineSrc + '\n' + PROC], { type: 'text/javascript' }));
          await ctx.audioWorklet.addModule(url);
          URL.revokeObjectURL(url);
          node = new AudioWorkletNode(ctx, 'plant1', {
            numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2]
          });
          node.port.onmessage = function (ev) {
            var m = ev.data;
            if (m.type === 'stat') { S.voices = m.voices; S.meter = m.meter; }
          };
        } catch (err) { node = null; }
      }
      if (!node) node = makeLocalNode(ctx);
      var an = ctx.createAnalyser();
      an.fftSize = 1024;
      an.smoothingTimeConstant = 0.25;
      node.connect(an);
      an.connect(ctx.destination);
      S.ctx = ctx; S.node = node; S.analyser = an; S.ready = true;
      sendPatch();
      for (var m2 in S.held) post({ type: 'note', on: 1, midi: +m2, vel: 0.85 });
      if (ctx.state === 'suspended') ctx.resume();
    })();
    return S.starting;
  }

  /* -------------------------------------------------------------- 提示 */
  var toastT = 0;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(function () { t.classList.remove('show'); }, 1600);
  }

  /* -------------------------------------------------------------- 旋钮 */
  var ARC0 = -135, ARC1 = 135;
  function arcPath(c, cx, cy, r, a0, a1) {
    c.beginPath();
    c.arc(cx, cy, r, (a0 - 90) * Math.PI / 180, (a1 - 90) * Math.PI / 180, false);
    c.stroke();
  }
  var SRC_COL = { env1: '#a78bfa', env2: '#a78bfa', env3: '#a78bfa', lfo1: '#c084fc', lfo2: '#c084fc', chaos: '#f472b6', macro: '#fbbf24', vel: '#38bdf8', key: '#38bdf8', mw: '#38bdf8', at: '#38bdf8', rnd: '#f472b6' };

  function makeKnob(host, id, opts) {
    opts = opts || {};
    var d = P[id];
    var wrap = el('div', 'knob');
    wrap.dataset.param = id;
    var cv = el('canvas', 'kcanvas');
    cv.width = 80; cv.height = 80;
    var lb = el('div', 'klabel', opts.label || d.label);
    var vv = el('div', 'kval');
    wrap.appendChild(cv); wrap.appendChild(lb); wrap.appendChild(vv);
    host.appendChild(wrap);
    var g = cv.getContext('2d');
    var color = opts.color || '#38bdf8';

    var inst = { el: wrap, id: id };
    inst.update = function () {
      if (!cv.isConnected) return;
      var v = S.patch[id];
      var n = PLANT.toNorm(d, v);
      var list = S.mods.filter(function (m) { return m.target === id; });
      g.clearRect(0, 0, 80, 80);
      g.lineCap = 'round';
      g.strokeStyle = '#1b2634'; g.lineWidth = 6;
      arcPath(g, 40, 40, 29, ARC0, ARC1);
      list.forEach(function (m, i) {
        var col = SRC_COL[m.src] || '#a78bfa';
        var a0 = ARC0 + 270 * n;
        var a1 = ARC0 + 270 * clamp(n + m.amt, 0, 1);
        g.strokeStyle = col; g.globalAlpha = 0.85; g.lineWidth = 3;
        arcPath(g, 40, 40, 21 + i * 4, Math.min(a0, a1), Math.max(a0, a1));
        g.globalAlpha = 1;
      });
      g.strokeStyle = color;
      g.lineWidth = 6;
      if (n > 0.004) arcPath(g, 40, 40, 29, ARC0, ARC0 + 270 * n);
      g.fillStyle = '#0b1119';
      g.beginPath(); g.arc(40, 40, 18, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#243141'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(40, 40, 18, 0, Math.PI * 2); g.stroke();
      var ang = (ARC0 + 270 * n - 90) * Math.PI / 180;
      g.strokeStyle = '#dce7f4'; g.lineWidth = 2.4; g.lineCap = 'round';
      g.beginPath();
      g.moveTo(40 + Math.cos(ang) * 6, 40 + Math.sin(ang) * 6);
      g.lineTo(40 + Math.cos(ang) * 15, 40 + Math.sin(ang) * 15);
      g.stroke();
      vv.textContent = fmtVal(id);
      wrap.classList.toggle('hasmode', list.length > 0);
    };

    var drag = null;
    wrap.addEventListener('pointerdown', function (e) {
      if (e.button === 2) return;
      e.preventDefault();
      wrap.setPointerCapture(e.pointerId);
      var mod = S.mods.find(function (m) { return m.target === id; });
      drag = {
        x: e.clientX, y: e.clientY,
        n: PLANT.toNorm(d, S.patch[id]),
        mod: (e.altKey && mod) ? mod : null,
        m0: mod ? mod.amt : 0
      };
      wrap.classList.add('active');
    });
    wrap.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dy = drag.y - e.clientY, dx = e.clientX - drag.x;
      var delta = (dy + dx * 0.45) * (e.shiftKey ? 0.2 : 1) / 165;
      if (drag.mod) {
        drag.mod.amt = clamp(drag.m0 + delta * 2, -1, 1);
        sendMods();
        renderMatrix();
      } else {
        setParam(id, valueFromNorm(d, drag.n + delta));
      }
    });
    wrap.addEventListener('pointerup', function (e) {
      if (!drag) return;
      drag = null;
      wrap.classList.remove('active');
      try { wrap.releasePointerCapture(e.pointerId); } catch (err) { }
      saveSoon();
    });
    wrap.addEventListener('dblclick', function () {
      setParam(id, d.def);
      toast(d.label + ' 已复位');
    });
    wrap.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      var had = S.mods.some(function (m) { return m.target === id; });
      if (!had) return;
      S.mods = S.mods.filter(function (m) { return m.target !== id; });
      sendMods(); renderMatrix();
      toast('已清除 ' + d.label + ' 的调制');
    });

    inst.update();
    (KNOBS[id] = KNOBS[id] || []).push(inst);
    return inst;
  }

  function refreshParam(id) {
    var list = KNOBS[id];
    if (list) for (var i = 0; i < list.length; i++) list[i].update();
    var sels = SELECTS[id];
    if (sels) for (var j = 0; j < sels.length; j++) sels[j].value = String(S.patch[id]);
    for (var k = 0; k < REFRESH.length; k++) REFRESH[k](id);
  }
  function pruneControls() {
    for (var id in KNOBS) {
      KNOBS[id] = KNOBS[id].filter(function (k) { return k.el.isConnected; });
      if (!KNOBS[id].length) delete KNOBS[id];
    }
    for (var s in SELECTS) {
      SELECTS[s] = SELECTS[s].filter(function (e) { return e.isConnected; });
      if (!SELECTS[s].length) delete SELECTS[s];
    }
  }
  function refreshAllKnobs() {
    pruneControls();
    for (var id in KNOBS) for (var i = 0; i < KNOBS[id].length; i++) KNOBS[id][i].update();
    for (var s in SELECTS) for (var j = 0; j < SELECTS[s].length; j++) SELECTS[s][j].value = String(S.patch[s]);
    for (var k = 0; k < REFRESH.length; k++) REFRESH[k](null);
  }

  /* 载入新音色后，发生器/效果器的旋钮组要按新类型重建 */
  function applyPatchUI() {
    buildGens();
    buildFx();
    refreshAllKnobs();
    renderMatrix();
    updatePresetLabel();
  }

  function makeSelect(host, id, opts) {
    opts = opts || {};
    var d = P[id];
    var sel = el('select', 'sel');
    (d.values || []).forEach(function (v, i) {
      var o = el('option', null, v);
      o.value = String(i);
      sel.appendChild(o);
    });
    sel.value = String(S.patch[id]);
    sel.addEventListener('change', function () {
      setParam(id, +sel.value);
      if (opts.onChange) opts.onChange(+sel.value);
    });
    host.appendChild(sel);
    (SELECTS[id] = SELECTS[id] || []).push(sel);
    return sel;
  }

  function makePower(host, id, after) {
    var btn = el('button', 'pwr', '\u25CF');
    btn.title = '开关';
    function sync() { btn.classList.toggle('on', !!Math.round(S.patch[id])); }
    btn.addEventListener('click', function () {
      setParam(id, Math.round(S.patch[id]) ? 0 : 1);
      sync();
      if (after) after();
    });
    sync();
    host.appendChild(btn);
    REFRESH.push(function () { if (btn.isConnected) sync(); });
    return btn;
  }

  /* ------------------------------------------------------------ 预置/状态 */
  function updatePresetLabel() {
    var p = PRESETS[S.preset] || { name: '用户音色', en: 'USER' };
    $('presetName').textContent = p.name;
    $('presetEn').textContent = p.en;
    $('sPreset').textContent = p.en;
    var list = $('presetList').children;
    for (var i = 0; i < list.length; i++) list[i].classList.toggle('cur', i === S.preset);
  }

  function loadPreset(i, silent) {
    S.preset = ((i % PRESETS.length) + PRESETS.length) % PRESETS.length;
    var p = PRESETS[S.preset];
    var patch = PLANT.defaults();
    for (var k in p.params) patch[k] = p.params[k];
    S.patch = patch;
    S.mods = (p.mods || []).map(function (m) { return { src: m.src, target: m.target, amt: m.amt }; });
    S.patch.mods = S.mods;
    updatePresetLabel();
    applyPatchUI();
    sendPatch();
    if (!silent) saveSoon();
  }

  var saveT = 0;
  function saveSoon() {
    clearTimeout(saveT);
    saveT = setTimeout(function () {
      try {
        localStorage.setItem('plant1.patch', JSON.stringify({ params: S.patch, mods: S.mods }));
      } catch (e) { }
    }, 500);
  }
  function loadLocal() {
    try {
      var raw = localStorage.getItem('plant1.patch');
      if (!raw) return false;
      var o = JSON.parse(raw);
      if (!o || !o.params) return false;
      S.patch = Object.assign(PLANT.defaults(), o.params);
      S.mods = o.mods || [];
      S.patch.mods = S.mods;
      S.preset = -1;
      return true;
    } catch (e) { return false; }
  }

  /* -------------------------------------------------------------- 面板 */
  function panel(title, cls) {
    var p = el('div', 'panel ' + (cls || ''));
    var h = el('h3');
    h.appendChild(el('span', 'dot'));
    h.appendChild(document.createTextNode(title));
    p.appendChild(h);
    return p;
  }

  /* --- VOICE --- */
  function buildVoice() {
    var host = $('colVoice');
    host.innerHTML = '';
    var p = panel('VOICE · 声部');
    var row = el('div', 'knobrow');
    makeKnob(row, 'voice.poly', { color: '#38bdf8' });
    makeKnob(row, 'voice.unison', { color: '#38bdf8' });
    makeKnob(row, 'voice.detune', { color: '#38bdf8' });
    makeKnob(row, 'voice.spread', { color: '#38bdf8' });
    makeKnob(row, 'voice.glide', { color: '#38bdf8' });
    makeKnob(row, 'voice.bend', { color: '#38bdf8' });
    makeKnob(row, 'voice.gain', { color: '#4ade80', label: '音量' });
    makeKnob(row, 'tempo', { color: '#4ade80' });
    p.appendChild(row);
    var info = el('div', 'mempty');
    info.style.cssText = 'padding:2px 2px 0;font-size:8px;color:#4d5a6b;letter-spacing:.05em';
    info.innerHTML = '固件 v' + PLANT.version + ' · FM1-OPEN 应用层';
    p.appendChild(info);
    host.appendChild(p);
  }

  /* --- 全局滤波 --- */
  function buildFilter() {
    var p = panel('FILTER · 滤波');
    var h = p.querySelector('h3');
    var pw = makePower(h, 'flt.on');
    pw.style.marginLeft = 'auto';
    var selWrap = el('div');
    selWrap.style.cssText = 'width:76px;flex:0 0 auto';
    makeSelect(selWrap, 'flt.type');
    selWrap.querySelector('select').style.fontSize = '9px';
    h.appendChild(selWrap);
    var row = el('div', 'knobrow');
    makeKnob(row, 'flt.cut', { color: '#22d3ee' });
    makeKnob(row, 'flt.res', { color: '#22d3ee' });
    makeKnob(row, 'flt.drive', { color: '#22d3ee' });
    p.appendChild(row);
    $('colVoice').appendChild(p);
  }

  /* --- 发生器 --- */
  var GEN_KNOBS = {
    0: ['level', 'pan', 'tune', 'pwm', 'cut', 'res'],
    1: ['level', 'pan', 'tune', 'morph', 'cut', 'res'],
    2: ['level', 'pan', 'tune', 'ratio', 'index', 'fb', 'cut', 'res'],
    3: ['level', 'pan', 'tune', 'color', 'cut', 'res']
  };
  var GEN_EXTRA_SELECT = { 0: 'wave', 1: 'table', 2: null, 3: null };
  var GEN_LABEL = {
    level: '电平', pan: '声像', tune: '音高', pwm: '脉宽', cut: '截止', res: '共振',
    morph: '形变', ratio: '比率', index: '指数', fb: '反馈', color: '色温', wave: '波形', table: '波表'
  };

  function drawGenPreview(cv, g) {
    if (!cv.isConnected) return;
    var dpr = window.devicePixelRatio || 1;
    var w = Math.max(40, cv.clientWidth || 74);
    var h = Math.max(30, cv.clientHeight || 44);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    var c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);

    c.strokeStyle = '#0f1b25'; c.lineWidth = 1;
    for (var k = 1; k < 4; k++) {
      var gy = h * k / 4;
      c.beginPath(); c.moveTo(0, gy); c.lineTo(w, gy); c.stroke();
    }

    var on = Math.round(S.patch['gen' + g + '.on']);
    if (!on) {
      c.strokeStyle = '#16232f'; c.lineWidth = 1.3; c.setLineDash([3, 5]);
      c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.stroke();
      c.setLineDash([]);
      c.font = '600 10px ui-monospace, monospace';
      c.fillStyle = '#1d2f40';
      c.textAlign = 'right';
      c.fillText('OFF', w - 8, h / 2 - 6);
      return;
    }

    var type = Math.round(S.patch['gen' + g + '.type']);
    var N = Math.max(140, Math.round(w * 1.4));
    var cycles = 2;
    var amp = h * 0.40;
    var pts = new Array(N + 1);
    var i, t, ph, v;
    for (i = 0; i <= N; i++) {
      t = i / N * cycles;
      ph = t % 1;
      v = 0;
      if (type === 0) {
        var wv = Math.round(S.patch['gen' + g + '.wave']);
        var pw = S.patch['gen' + g + '.pwm'];
        if (wv === 0) v = 2 * ph - 1;
        else if (wv === 1) v = ph < 0.5 ? 1 : -1;
        else if (wv === 2) v = ph < pw ? 1 : -1;
        else v = Math.sin(ph * Math.PI * 2);
      } else if (type === 1) {
        var mo = S.patch['gen' + g + '.morph'];
        v = Math.sin(ph * Math.PI * 2) * (1 - mo) + (2 * ph - 1) * mo;
      } else if (type === 2) {
        var idx = S.patch['gen' + g + '.index'];
        var ratio = S.patch['gen' + g + '.ratio'];
        v = Math.sin(ph * Math.PI * 2 + idx * Math.sin(ph * Math.PI * 2 * ratio)) * 0.85;
      } else {
        var seed = (i * 2654435761) % 4294967296 / 4294967296;
        v = (seed * 2 - 1) * 0.7 + (i % 2 ? 0.12 : -0.12);
      }
      pts[i] = { x: i / N * w, y: h / 2 - v * amp };
    }

    var grd = c.createLinearGradient(0, h / 2 - amp, 0, h / 2 + amp);
    grd.addColorStop(0, 'rgba(56,189,248,.26)');
    grd.addColorStop(1, 'rgba(56,189,248,.02)');
    c.beginPath();
    c.moveTo(0, h / 2);
    for (i = 0; i <= N; i++) c.lineTo(pts[i].x, pts[i].y);
    c.lineTo(w, h / 2);
    c.closePath();
    c.fillStyle = grd;
    c.fill();

    c.beginPath();
    for (i = 0; i <= N; i++) {
      if (i === 0) c.moveTo(pts[i].x, pts[i].y); else c.lineTo(pts[i].x, pts[i].y);
    }
    c.strokeStyle = '#38bdf8';
    c.lineWidth = 1.5;
    c.lineJoin = 'round';
    c.stroke();
  }

  function genIds(g) {
    return ['on', 'type', 'level', 'pan', 'tune', 'cut', 'res', 'ftype', 'wave', 'pwm', 'table', 'morph', 'ratio', 'index', 'fb', 'color']
      .map(function (k) { return 'gen' + g + '.' + k; });
  }

  function buildGens() {
    var host = $('colGens');
    host.innerHTML = '';
    for (var g = 0; g < 4; g++) buildGen(g, host);
    REFRESH.push(function (id) {
      if (!id || id.indexOf('gen') === 0) {
        for (var i = 0; i < 4; i++) {
          var card = host.children[i];
          if (!card) continue;
          card.classList.toggle('off', !Math.round(S.patch['gen' + i + '.on']));
          var pv = card.querySelector('.gen-prev');
          if (pv) drawGenPreview(pv, i);
        }
      }
    });
  }

  function buildGen(g, host) {
    var ids = genIds(g);
    for (var i = 0; i < ids.length; i++) { delete KNOBS[ids[i]]; delete SELECTS[ids[i]]; }

    var card = el('div', 'gen' + (Math.round(S.patch['gen' + g + '.on']) ? '' : ' off'));
    var head = el('div', 'gen-h');
    head.appendChild(el('span', 'tag', 'G' + (g + 1)));
    var typeSel = el('select', 'sel');
    PLANT.GEN_TYPES.forEach(function (name, i) {
      var o = el('option', null, 'G' + (g + 1) + ' · ' + name + ' / ' + PLANT.GEN_TYPES_EN[i]);
      o.value = String(i);
      typeSel.appendChild(o);
    });
    typeSel.value = String(Math.round(S.patch['gen' + g + '.type']));
    typeSel.addEventListener('change', function () {
      setParam('gen' + g + '.type', +typeSel.value);
      rebuildGenCard(g);
    });
    head.appendChild(typeSel);
    makePower(head, 'gen' + g + '.on', function () { rebuildGenCard(g); });
    card.appendChild(head);

    var body = el('div', 'gen-body');
    var pv = el('canvas', 'gen-prev');
    body.appendChild(pv);
    var knobs = el('div', 'gen-knobs');
    body.appendChild(knobs);
    card.appendChild(body);

    var foot = el('div', 'gen-foot');
    var extra = GEN_EXTRA_SELECT[Math.round(S.patch['gen' + g + '.type'])];
    if (extra) {
      foot.appendChild(el('span', 'lbl', extra === 'wave' ? 'WAVE' : 'TABLE'));
      var extraWrap = el('div');
      extraWrap.style.cssText = 'width:86px';
      makeSelect(extraWrap, 'gen' + g + '.' + extra, {
        onChange: function () { rebuildGenCard(g); }
      });
      foot.appendChild(extraWrap);
    }
    foot.appendChild(el('span', 'lbl', 'FILTER'));
    var fsel = el('select', 'sel');
    PLANT.FTYPES.forEach(function (name, idx) {
      var o = el('option', null, name + ' / ' + PLANT.FTYPES_EN[idx]);
      o.value = String(idx);
      fsel.appendChild(o);
    });
    fsel.value = String(Math.round(S.patch['gen' + g + '.ftype']));
    fsel.addEventListener('change', function () { setParam('gen' + g + '.ftype', +fsel.value); });
    foot.appendChild(fsel);
    card.appendChild(foot);

    host.appendChild(card);

    var type = Math.round(S.patch['gen' + g + '.type']);
    GEN_KNOBS[type].forEach(function (k2) {
      makeKnob(knobs, 'gen' + g + '.' + k2, { label: GEN_LABEL[k2] || k2 });
    });
    requestAnimationFrame(function () { drawGenPreview(pv, g); });
  }

  function rebuildGenCard(g) {
    var host = $('colGens');
    var old = host.children[g];
    if (!old) return;
    var frag = document.createDocumentFragment();
    buildGen(g, frag);
    host.replaceChild(frag.firstChild, old);
  }

  /* --- 调制器 --- */
  function envLayout(e, W, H) {
    var pad = 5;
    var a = S.patch['env' + e + '.a'], d = S.patch['env' + e + '.d'];
    var r = S.patch['env' + e + '.r'], s = S.patch['env' + e + '.s'];
    var usable = W - pad * 2;
    var total = Math.max(0.02, a + d + r + 0.1);
    var wa = Math.max(7, usable * a / total);
    var wd = Math.max(7, usable * d / total);
    var ws = usable * 0.16;
    var wr = Math.max(7, usable * r / total);
    var k = usable / (wa + wd + ws + wr);
    wa *= k; wd *= k; ws *= k; wr *= k;
    var x0 = pad + 1, x1 = x0 + wa, x2 = x1 + wd, x3 = x2 + ws, x4 = x3 + wr;
    var y0 = pad + 2, yb = H - pad, yS = pad + (H - pad * 2 - 2) * (1 - s);
    return { x0: x0, x1: x1, x2: x2, x3: x3, x4: x4, y0: y0, yS: yS, yb: yb };
  }

  function drawEnv(cv, e) {
    if (!cv.isConnected) return;
    var w = cv.clientWidth || 280, h = cv.clientHeight || 30;
    var dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    var c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    var L = envLayout(e, w, h);
    c.strokeStyle = '#241a3d'; c.lineWidth = 1;
    for (var i = 1; i < 4; i++) {
      var x = L.x0 + (L.x4 - L.x0) * i / 4;
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke();
    }
    c.beginPath();
    c.moveTo(L.x0, L.yb);
    c.lineTo(L.x1, L.y0);
    c.lineTo(L.x2, L.yS);
    c.lineTo(L.x3, L.yS);
    c.lineTo(L.x4, L.yb);
    c.strokeStyle = '#a78bfa'; c.lineWidth = 1.8; c.lineJoin = 'round'; c.stroke();
    var grd = c.createLinearGradient(0, L.y0, 0, L.yb);
    grd.addColorStop(0, 'rgba(167,139,250,.30)');
    grd.addColorStop(1, 'rgba(167,139,250,.02)');
    c.lineTo(L.x4, L.yb); c.lineTo(L.x0, L.yb); c.closePath();
    c.fillStyle = grd; c.fill();
    [[L.x1, L.y0], [L.x2, L.yS], [L.x3, L.yS]].forEach(function (pt) {
      c.beginPath(); c.arc(pt[0], pt[1], 3.2, 0, Math.PI * 2);
      c.fillStyle = '#c4b5fd'; c.fill();
    });
  }

  function bindEnvDrag(cv, e) {
    var drag = null;
    cv.addEventListener('pointerdown', function (ev) {
      var r = cv.getBoundingClientRect();
      var x = ev.clientX - r.left, y = ev.clientY - r.top;
      var L = envLayout(e, r.width, r.height);
      var cands = [
        { t: 'a', x: L.x1, y: L.y0 }, { t: 'ds', x: L.x2, y: L.yS }, { t: 'r', x: L.x3, y: L.yS }
      ];
      var best = null, bd = 24;
      cands.forEach(function (c) {
        var dd = Math.sqrt((c.x - x) * (c.x - x) + (c.y - y) * (c.y - y));
        if (dd < bd) { bd = dd; best = c; }
      });
      if (!best) return;
      ev.preventDefault();
      cv.setPointerCapture(ev.pointerId);
      drag = {
        t: best.t, x0: x, y0: y,
        a: S.patch['env' + e + '.a'], d: S.patch['env' + e + '.d'],
        r: S.patch['env' + e + '.r'], s: S.patch['env' + e + '.s']
      };
    });
    cv.addEventListener('pointermove', function (ev) {
      if (!drag) return;
      var r = cv.getBoundingClientRect();
      var dx = ev.clientX - r.left - drag.x0;
      var dy = ev.clientY - r.top - drag.y0;
      var k = Math.exp(dx / 55);
      if (drag.t === 'a') setParam('env' + e + '.a', clamp(drag.a * k, 0.001, 8));
      else if (drag.t === 'r') setParam('env' + e + '.r', clamp(drag.r * k, 0.002, 10));
      else if (drag.t === 'ds') {
        setParam('env' + e + '.d', clamp(drag.d * k, 0.002, 8));
        setParam('env' + e + '.s', clamp(drag.s - dy / (r.height - 8), 0, 1));
      }
    });
    cv.addEventListener('pointerup', function (ev) {
      drag = null;
      try { cv.releasePointerCapture(ev.pointerId); } catch (err) { }
    });
  }

  function buildEnv(e, host) {
    var card = el('div', 'mod');
    var h = el('div', 'mod-h');
    var tag = el('span', 'tag', 'ENV' + (e + 1));
    tag.title = '拖到旋钮上建立调制';
    bindModDrag(tag, 'env' + (e + 1));
    h.appendChild(tag);
    h.appendChild(el('span', 'nm', ['包络 1', '包络 2', '包络 3'][e]));
    card.appendChild(h);
    var cv = el('canvas', 'ed');
    cv.style.height = '30px';
    card.appendChild(cv);
    var row = el('div', 'knobrow');
    ['a', 'd', 's', 'r'].forEach(function (k) {
      makeKnob(row, 'env' + e + '.' + k, { color: '#a78bfa', label: { a: '起音', d: '衰减', s: '延持', r: '释放' }[k] });
    });
    card.appendChild(row);
    host.appendChild(card);
    bindEnvDrag(cv, e);
    REFRESH.push(function (id) {
      if (!id || id.indexOf('env' + e + '.') === 0) drawEnv(cv, e);
    });
    requestAnimationFrame(function () { drawEnv(cv, e); });
  }

  var lfoPhase = [0, 0];
  function lfoRate(l) {
    var beat = 60 / S.patch['tempo'];
    var divs = [32, 16, 8, 2, 1, 0.5, 0.25, 0.125];
    return Math.round(S.patch['lfo' + l + '.sync']) ? 1 / (beat * divs[Math.round(S.patch['lfo' + l + '.div'])]) : S.patch['lfo' + l + '.rate'];
  }
  function lfoShape(l, ph) {
    var s = Math.round(S.patch['lfo' + l + '.shape']);
    switch (s) {
      case 0: return Math.sin(ph * Math.PI * 2);
      case 1: return 1 - 4 * Math.abs(ph - 0.5);
      case 2: return ph * 2 - 1;
      case 3: return 1 - ph * 2;
      case 4: return ph < 0.5 ? 1 : -1;
      case 5: return Math.sin(ph * 12.9898) * 0.9;
      default: return Math.sin(ph * Math.PI * 4) * 0.6;
    }
  }
  function drawLfo(cv, l) {
    if (!cv.isConnected) return;
    var w = cv.clientWidth || 280, h = cv.clientHeight || 30;
    var dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    var c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    c.strokeStyle = '#241a3d'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.stroke();
    var col = Math.round(S.patch['lfo' + l + '.uni']) ? '#c084fc' : '#a78bfa';
    var N = 120;
    c.beginPath();
    for (var i = 0; i <= N; i++) {
      var ph = (i / N + lfoPhase[l]) % 1;
      var v = lfoShape(l, ph) * 0.86;
      var y = h / 2 - v * (h / 2 - 3);
      var x = i / N * w;
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.strokeStyle = col; c.lineWidth = 1.5; c.stroke();
    var vNow = lfoShape(l, lfoPhase[l]) * 0.86;
    c.beginPath(); c.arc(2, h / 2 - vNow * (h / 2 - 3), 2.6, 0, Math.PI * 2);
    c.fillStyle = '#e9d5ff'; c.fill();
  }

  function buildLfo(l, host) {
    var card = el('div', 'mod');
    var h = el('div', 'mod-h');
    var tag = el('span', 'tag', 'LFO' + (l + 1));
    tag.title = '拖到旋钮上建立调制';
    bindModDrag(tag, 'lfo' + (l + 1));
    h.appendChild(tag);
    h.appendChild(el('span', 'nm', '低频振荡 ' + (l + 1)));
    card.appendChild(h);
    var cv = el('canvas', 'ed');
    cv.style.height = '30px';
    card.appendChild(cv);
    (S.lfoCv = S.lfoCv || [])[l] = cv;
    var row = el('div', 'knobrow');
    makeKnob(row, 'lfo' + l + '.rate', { color: '#a78bfa', label: '速率' });
    makeKnob(row, 'lfo' + l + '.amp', { color: '#a78bfa', label: '幅度' });
    var selWrap = el('div');
    selWrap.style.cssText = 'width:78px;align-self:center';
    makeSelect(selWrap, 'lfo' + l + '.shape');
    row.appendChild(selWrap);
    card.appendChild(row);
    var foot = el('div', 'gen-foot');
    var uniBtn = el('button', 'pwr' + (Math.round(S.patch['lfo' + l + '.uni']) ? ' on' : ''), 'UNI');
    uniBtn.style.cssText = 'width:auto;height:16px;border-radius:3px;font:7.5px monospace;padding:0 5px';
    uniBtn.title = '单极输出（0…1，而不是 -1…1）';
    uniBtn.addEventListener('click', function () {
      setParam('lfo' + l + '.uni', Math.round(S.patch['lfo' + l + '.uni']) ? 0 : 1);
      uniBtn.classList.toggle('on', !!Math.round(S.patch['lfo' + l + '.uni']));
    });
    foot.appendChild(uniBtn);
    var sync = el('button', 'pwr' + (Math.round(S.patch['lfo' + l + '.sync']) ? ' on' : ''), 'SYNC');
    sync.style.cssText = 'width:auto;height:16px;border-radius:3px;font:7.5px monospace;padding:0 5px';
    sync.addEventListener('click', function () {
      setParam('lfo' + l + '.sync', Math.round(S.patch['lfo' + l + '.sync']) ? 0 : 1);
      sync.classList.toggle('on', !!Math.round(S.patch['lfo' + l + '.sync']));
    });
    foot.appendChild(sync);
    var divWrap = el('div');
    divWrap.style.cssText = 'flex:1;display:flex;align-items:center;gap:4px';
    divWrap.appendChild(el('span', 'lbl', 'DIV'));
    makeSelect(divWrap, 'lfo' + l + '.div');
    foot.appendChild(divWrap);
    card.appendChild(foot);
    host.appendChild(card);
    REFRESH.push(function (id) {
      if (!id || id.indexOf('lfo' + l + '.') === 0) drawLfo(cv, l);
    });
    requestAnimationFrame(function () { drawLfo(cv, l); });
  }

  function buildMods() {
    var host = $('colMods');
    host.innerHTML = '';
    for (var e = 0; e < 3; e++) buildEnv(e, host);
    for (var l = 0; l < 2; l++) buildLfo(l, host);

    var others = el('div');
    others.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px';
    var ch = el('div', 'mod');
    var chh = el('div', 'mod-h');
    var ctag = el('span', 'tag', 'CHAOS');
    ctag.title = '拖到旋钮上建立调制';
    bindModDrag(ctag, 'chaos');
    chh.appendChild(ctag);
    ch.appendChild(chh);
    var chr = el('div', 'knobrow');
    makeKnob(chr, 'chaos.rate', { color: '#f472b6', label: '速率' });
    makeKnob(chr, 'chaos.smooth', { color: '#f472b6', label: '平滑' });
    ch.appendChild(chr);
    others.appendChild(ch);

    var mc = el('div', 'mod');
    var mh = el('div', 'mod-h');
    var mtag = el('span', 'tag', 'MACRO');
    mtag.title = '拖到旋钮上建立调制';
    bindModDrag(mtag, 'macro');
    mh.appendChild(mtag);
    mc.appendChild(mh);
    var mr = el('div', 'knobrow');
    makeKnob(mr, 'macro.val', { color: '#fbbf24', label: '宏控' });
    mc.appendChild(mr);
    others.appendChild(mc);

    var mp = panel('MOD MATRIX · 调制矩阵', 'mods mat');
    var chips = el('div', 'srcchips');
    [['vel', '力度'], ['key', '键位'], ['mw', '调制轮'], ['at', '触后'], ['rnd', '随机']].forEach(function (p) {
      var t = el('span', 'chip', p[1]);
      t.title = '拖到旋钮上建立调制';
      bindModDrag(t, p[0]);
      chips.appendChild(t);
    });
    mp.appendChild(chips);
    var mbox = el('div', 'matrix');
    mbox.id = 'matrix';
    mp.appendChild(mbox);
    $('colVoice').appendChild(mp);
    $('colVoice').appendChild(others);
  }

  function renderMatrix() {
    var box = $('matrix');
    if (!box) return;
    box.innerHTML = '';
    if (!S.mods.length) {
      box.appendChild(el('div', 'mempty', '把 ENV / LFO / CHAOS / MACRO 的标签拖到任意旋钮上即可接线。按住 Alt 拖旋钮可调调制深度。'));
      return;
    }
    S.mods.forEach(function (m, idx) {
      var item = el('div', 'mitem');
      var row = el('div', 'mrow');
      var src = el('span', 'src', m.src.toUpperCase());
      src.style.cssText = 'color:' + (PLANT.SOURCE_COLORS[PLANT.MOD_SOURCES.indexOf(m.src)] || '#a78bfa') + ';background:#1b1430';
      row.appendChild(src);
      var tgt = el('span', 'tgt', P[m.target] ? P[m.target].label : m.target);
      tgt.title = m.target;
      row.appendChild(tgt);
      var del = el('button', 'del', '\u00D7');
      del.title = '删除这条调制';
      del.addEventListener('click', function () {
        S.mods.splice(idx, 1);
        sendMods(); renderMatrix();
      });
      row.appendChild(del);
      item.appendChild(row);
      var sl = el('div', 'mslider');
      var rng = el('input');
      rng.type = 'range';
      rng.min = -1; rng.max = 1; rng.step = 0.01; rng.value = m.amt;
      var amt = el('span', 'amt', (m.amt > 0 ? '+' : '') + Math.round(m.amt * 100) + '%');
      rng.addEventListener('input', function () {
        m.amt = +rng.value;
        amt.textContent = (m.amt > 0 ? '+' : '') + Math.round(m.amt * 100) + '%';
        sendMods();
      });
      sl.appendChild(rng);
      sl.appendChild(amt);
      item.appendChild(sl);
      box.appendChild(item);
    });
  }

  /* --- 效果 --- */
  var FX_PARAM_LABELS = {
    0: ['增益', '音色', ''],
    1: ['位数', '降采样', ''],
    2: ['速率', '深度', '反馈'],
    3: ['速率', '深度', '反馈'],
    4: ['时间', '反馈', '音色'],
    5: ['空间', '阻尼', ''],
    6: ['倾斜', '低频', '高频'],
    7: ['阈值', '压缩', '释放'],
    8: ['截止', '共振', ''],
    9: ['宽度', '中置', '']
  };

  function buildFx() {
    var host = $('fxrow');
    host.innerHTML = '';
    for (var i = 0; i < 5; i++) buildFxSlot(i, host);
    buildMaster(host);
  }

  function buildFxSlot(i, host) {
    ['on', 'type', 'p1', 'p2', 'p3', 'mix'].forEach(function (k) { delete KNOBS['fx' + i + '.' + k]; delete SELECTS['fx' + i + '.' + k]; });
    var card = el('div', 'fx' + (Math.round(S.patch['fx' + i + '.on']) ? '' : ' off'));
    var h = el('div', 'fx-h');
    h.appendChild(el('span', 'tag', 'FX' + (i + 1)));
    var sel = el('select', 'sel');
    PLANT.FX_TYPES.forEach(function (name, t) {
      var o = el('option', null, name + ' / ' + PLANT.FX_EN[t]);
      o.value = String(t);
      sel.appendChild(o);
    });
    sel.value = String(Math.round(S.patch['fx' + i + '.type']));
    sel.addEventListener('change', function () {
      setParam('fx' + i + '.type', +sel.value);
      rebuildFxSlot(i);
    });
    h.appendChild(sel);
    makePower(h, 'fx' + i + '.on', function () { rebuildFxSlot(i); });
    card.appendChild(h);

    var type = Math.round(S.patch['fx' + i + '.type']);
    var labels = FX_PARAM_LABELS[type] || ['A', 'B', 'C'];
    var row = el('div', 'knobrow');
    ['p1', 'p2', 'p3'].forEach(function (k, j) {
      if (!labels[j]) return;
      makeKnob(row, 'fx' + i + '.' + k, { color: '#fb923c', label: labels[j] });
    });
    makeKnob(row, 'fx' + i + '.mix', { color: '#fb923c', label: '混合' });
    card.appendChild(row);
    host.appendChild(card);
  }

  function rebuildFxSlot(i) {
    var host = $('fxrow');
    var old = host.children[i];
    if (!old) return;
    var frag = document.createDocumentFragment();
    buildFxSlot(i, frag);
    host.replaceChild(frag.firstChild, old);
  }

  function buildMaster(host) {
    var card = el('div', 'fx master');
    var h = el('div', 'fx-h');
    h.appendChild(el('span', 'tag', 'OUT'));
    h.appendChild(el('span', 'lbl', '主输出'));
    card.appendChild(h);
    var info = el('div', 'mempty');
    info.style.cssText = 'padding:0;font-size:8px;letter-spacing:.06em;color:#3f6b52';
    info.textContent = '软限幅 · DC 阻断';
    card.appendChild(info);
    var meter = el('div', 'meter');
    var bar = el('i');
    meter.appendChild(bar);
    card.appendChild(meter);
    var row = el('div', 'knobrow');
    makeKnob(row, 'voice.gain', { color: '#4ade80', label: '音量' });
    card.appendChild(row);
    host.appendChild(card);
    S.meterBar = bar;
  }

  /* --- 键盘 --- */
  var BASE = 48;
  var NAME = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  function isBlack(m) { var n = ((m % 12) + 12) % 12; return n === 1 || n === 3 || n === 6 || n === 8 || n === 10; }
  function noteName(m) { return NAME[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1); }

  function buildKeyboard() {
    var kbd = $('kbd');
    kbd.innerHTML = '';
    var start = BASE + S.octave * 12;
    var notes = [];
    for (var i = 0; i < 27; i++) notes.push(start + i);
    var whites = notes.filter(function (m) { return !isBlack(m); });
    var w = 100 / whites.length;
    var wi = 0;
    whites.forEach(function (m) {
      var k = el('div', 'wkey');
      k.style.left = (wi * w) + '%';
      k.style.width = w + '%';
      k.dataset.midi = String(m);
      if (m % 12 === 0) k.textContent = noteName(m);
      kbd.appendChild(k);
      wi++;
    });
    notes.forEach(function (m) {
      if (!isBlack(m)) return;
      var idx = 0;
      for (var j = 0; j < whites.length; j++) if (whites[j] < m) idx = j + 1;
      var k = el('div', 'bkey');
      k.style.left = 'calc(' + (idx * w) + '% - ' + (w * 0.3) + '%)';
      k.style.width = (w * 0.6) + '%';
      k.dataset.midi = String(m);
      kbd.appendChild(k);
    });
    for (var h = 0; h < 27; h++) {
      var kk = keyEl(start + h);
      if (kk && S.held[start + h]) kk.classList.add('on');
    }
  }

  function keyEl(midi) {
    var kbd = $('kbd');
    return kbd ? kbd.querySelector('[data-midi="' + midi + '"]') : null;
  }

  function press(midi, vel) {
    if (S.held[midi]) return;
    S.held[midi] = true;
    var k = keyEl(midi);
    if (k) k.classList.add('on');
    ensureAudio();
    post({ type: 'note', on: 1, midi: midi, vel: vel === undefined ? 0.9 : vel });
  }
  function release(midi) {
    if (!S.held[midi]) return;
    delete S.held[midi];
    var k = keyEl(midi);
    if (k) k.classList.remove('on');
    if (S.hold) { S.sustained[midi] = true; return; }
    post({ type: 'note', on: 0, midi: midi });
  }
  function releaseAll() {
    for (var m in S.held) release(+m);
    for (var s in S.sustained) post({ type: 'note', on: 0, midi: +s });
    S.sustained = {};
    if (S.hold) { S.hold = false; updateHold(); }
  }
  function updateHold() {
    var b = $('holdBtn');
    b.textContent = '保持 ' + (S.hold ? 'ON' : 'OFF');
    b.style.color = S.hold ? '#4ade80' : '';
  }

  var ptr = null;
  function bindKeyboard() {
    var kbd = $('kbd');
    kbd.addEventListener('pointerdown', function (e) {
      var t = e.target.closest('.wkey,.bkey');
      if (!t) return;
      e.preventDefault();
      if (!S.ctx) ensureAudio();
      var midi = +t.dataset.midi;
      ptr = { id: e.pointerId, midi: midi };
      press(midi, 0.55 + Math.random() * 0.4);
    });
    window.addEventListener('pointermove', function (e) {
      if (!ptr || e.pointerId !== ptr.id) return;
      var t = document.elementFromPoint(e.clientX, e.clientY);
      var k = t && t.closest ? t.closest('.wkey,.bkey') : null;
      if (!k) return;
      var midi = +k.dataset.midi;
      if (midi !== ptr.midi) {
        release(ptr.midi);
        ptr.midi = midi;
        press(midi, 0.8);
      }
    });
    window.addEventListener('pointerup', function (e) {
      if (!ptr || e.pointerId !== ptr.id) return;
      release(ptr.midi);
      ptr = null;
    });
    window.addEventListener('pointercancel', function (e) {
      if (!ptr || e.pointerId !== ptr.id) return;
      release(ptr.midi);
      ptr = null;
    });
  }

  var KEYMAP = {
    KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
    KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23,
    KeyI: 24, Digit9: 25, KeyO: 26
  };
  function bindComputerKeys() {
    window.addEventListener('keydown', function (e) {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (e.code === 'ArrowUp') { S.octave = clamp(S.octave + 1, -2, 2); buildKeyboard(); e.preventDefault(); return; }
      if (e.code === 'ArrowDown') { S.octave = clamp(S.octave - 1, -2, 2); buildKeyboard(); e.preventDefault(); return; }
      if (e.code === 'Space') { e.preventDefault(); releaseAll(); return; }
      var off = KEYMAP[e.code];
      if (off === undefined) return;
      e.preventDefault();
      if (e.repeat) return;
      press(BASE + S.octave * 12 + off, 0.9);
    });
    window.addEventListener('keyup', function (e) {
      var off = KEYMAP[e.code];
      if (off === undefined) return;
      release(BASE + S.octave * 12 + off);
    });
    window.addEventListener('blur', releaseAll);
  }

  /* --- MIDI（含 M-VAVE FM-1 控制器映射） --- */
  var FM1_ENC = { 20: 'flt.cut', 21: 'flt.res', 22: 'gen0.cut', 23: 'gen0.res', 24: 'macro.val', 25: 'voice.gain', 26: 'fx2.mix' };
  var FM1_BTN = ['上一个音色', '下一个音色', '静音', '保持', '初始化', '随机', '试听', '全局滤波', 'FX1', 'FX2', 'FX3', 'FX4', 'FX5', '—'];

  function fm1Encoder(cc, v) {
    var id = FM1_ENC[cc];
    if (!id || !P[id]) return;
    var d = P[id];
    var delta = v - 64;
    if (!delta) return;
    var n = PLANT.toNorm(d, S.patch[id]) + delta / 64 * 0.045;
    setParam(id, valueFromNorm(d, n));
  }

  function fm1Button(idx) {
    if (idx === 0) loadPreset(S.preset - 1);
    else if (idx === 1) loadPreset(S.preset + 1);
    else if (idx === 2) { releaseAll(); post({ type: 'panic' }); }
    else if (idx === 3) { S.hold = !S.hold; updateHold(); }
    else if (idx === 4) loadPreset(0);
    else if (idx === 5) randomPatch();
    else if (idx === 6) audition();
    else if (idx === 7) setParam('flt.on', Math.round(S.patch['flt.on']) ? 0 : 1);
    else if (idx >= 8 && idx <= 12) {
      var n = idx - 8;
      setParam('fx' + n + '.on', Math.round(S.patch['fx' + n + '.on']) ? 0 : 1);
    }
    if (idx < 13) toast('FM-1 · ' + FM1_BTN[idx]);
  }

  function handleMidi(d, isFM1) {
    var cmd = d[0] & 0xf0;
    if (cmd === 0x90 && d[2] > 0) { press(d[1], d[2] / 127); return; }
    if (cmd === 0x80 || (cmd === 0x90 && d[2] === 0)) { release(d[1]); return; }
    if (cmd === 0xb0) {
      var cc = d[1], v = d[2];
      if (cc === 1) { post({ type: 'mw', v: v / 127 }); return; }
      if (cc === 64) { if (v >= 64) { S.hold = true; updateHold(); } else { S.hold = false; updateHold(); } return; }
      if (isFM1) {
        if (cc >= 20 && cc <= 26) { fm1Encoder(cc, v); return; }
        if (cc >= 40 && cc <= 53) { if (v > 0) fm1Button(cc - 40); return; }
      }
      return;
    }
    if (cmd === 0xd0) { post({ type: 'at', v: d[1] / 127 }); return; }
    if (cmd === 0xe0) { post({ type: 'bend', v: ((d[2] << 7 | d[1]) - 8192) / 8192 }); return; }
  }

  function bindMidi() {
    if (!navigator.requestMIDIAccess) return;
    navigator.requestMIDIAccess().then(function (access) {
      function hook(input) {
        var isFM1 = /fm[-\s]?1|m[-\s]?vave/i.test(input.name || '');
        if (isFM1 && !S.device) {
          S.device = input.name;
          toast('FM-1 已连接，键盘和旋钮可用');
        }
        input.onmidimessage = function (msg) { handleMidi(msg.data, isFM1); };
      }
      access.inputs.forEach(hook);
      access.onstatechange = function (e) {
        if (e.port.type === 'input' && e.port.state === 'connected') hook(e.port);
      };
      var names = [];
      access.inputs.forEach(function (i) {
        names.push(i.name);
        if (/fm[-\s]?1|m[-\s]?vave/i.test(i.name || '')) S.device = i.name;
      });
      if (names.length) toast('MIDI 输入：' + names.join(' / '));
      if (S.device) toast('FM-1 已连接，键盘和旋钮可用');
    }).catch(function () { });
  }

  /* --- 拖拽调制 --- */
  function bindModDrag(tagEl, src) {
    tagEl.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var ghost = $('dropMod');
      var idx = PLANT.MOD_SOURCES.indexOf(src);
      ghost.textContent = (PLANT.MOD_LABELS[idx] || src).toUpperCase();
      ghost.style.display = 'block';
      document.body.classList.add('mod-dragging');
      document.querySelectorAll('.knob').forEach(function (k) { k.classList.add('target'); });
      function move(ev) {
        ghost.style.left = ev.clientX + 'px';
        ghost.style.top = ev.clientY + 'px';
      }
      function up(ev) {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        ghost.style.display = 'none';
        document.body.classList.remove('mod-dragging');
        document.querySelectorAll('.knob.target').forEach(function (k) { k.classList.remove('target'); });
        var el2 = document.elementFromPoint(ev.clientX, ev.clientY);
        var knobEl = el2 && el2.closest ? el2.closest('.knob') : null;
        if (knobEl && knobEl.dataset.param) addMod(src, knobEl.dataset.param);
        else toast('要拖到具体的旋钮上');
      }
      move(e);
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
  }

  function addMod(src, target) {
    var d = P[target];
    if (!d || d.slot < 0) { toast('「' + (d ? d.label : target) + '」不可调制'); return; }
    var ex = S.mods.find(function (m) { return m.src === src && m.target === target; });
    if (ex) ex.amt = clamp(ex.amt + 0.3, -1, 1);
    else S.mods.push({ src: src, target: target, amt: 0.5 });
    sendMods();
    renderMatrix();
    var idx = PLANT.MOD_SOURCES.indexOf(src);
    toast((PLANT.MOD_LABELS[idx] || src) + ' → ' + d.label + (ex ? ' 加深' : ' 已接线'));
    saveSoon();
  }

  /* --- 头部动作 --- */
  function bindHeader() {
    $('pPrev').addEventListener('click', function () { loadPreset(S.preset - 1); });
    $('pNext').addEventListener('click', function () { loadPreset(S.preset + 1); });
    $('pName').addEventListener('click', function (e) {
      e.stopPropagation();
      var list = $('presetList');
      if (!list.children.length) {
        PRESETS.forEach(function (p, i) {
          var b = el('button');
          b.appendChild(el('span', null, p.name));
          b.appendChild(el('em', null, p.en));
          b.addEventListener('click', function () {
            loadPreset(i);
            list.classList.remove('open');
          });
          list.appendChild(b);
        });
      }
      list.classList.toggle('open');
      updatePresetLabel();
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.preset')) $('presetList').classList.remove('open');
    });

    document.querySelectorAll('.acts button').forEach(function (b) {
      b.addEventListener('click', function () { act(b.dataset.act); });
    });
    $('fileIn').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          var o = JSON.parse(r.result);
          S.patch = Object.assign(PLANT.defaults(), o.params || {});
          S.mods = o.mods || [];
          S.patch.mods = S.mods;
          S.preset = -1;
          applyPatchUI();
          sendPatch();
          toast('已载入：' + (o.name || '用户音色'));
        } catch (err) { toast('文件读取失败'); }
      };
      r.readAsText(f);
      e.target.value = '';
    });
    $('octUp').addEventListener('click', function () { S.octave = clamp(S.octave + 1, -2, 2); buildKeyboard(); });
    $('octDown').addEventListener('click', function () { S.octave = clamp(S.octave - 1, -2, 2); buildKeyboard(); });
    $('holdBtn').addEventListener('click', function () {
      S.hold = !S.hold;
      updateHold();
      if (!S.hold) {
        for (var m in S.sustained) post({ type: 'note', on: 0, midi: +m });
        S.sustained = {};
      }
    });
  }

  function act(a) {
    if (a === 'init') { loadPreset(0); toast('已初始化'); }
    else if (a === 'rand') { randomPatch(); }
    else if (a === 'audition') { audition(); }
    else if (a === 'save') { exportPatch(); }
    else if (a === 'load') { $('fileIn').click(); }
    else if (a === 'flash') { flash(); }
    else if (a === 'panic') { releaseAll(); post({ type: 'panic' }); toast('全部静音'); }
  }

  var auditionTimers = [];
  function audition() {
    ensureAudio();
    auditionTimers.forEach(clearTimeout);
    auditionTimers = [];
    var seq = [[0, 60], [0.22, 64], [0.44, 67], [0.66, 72], [0.88, 67]];
    seq.forEach(function (n) {
      auditionTimers.push(setTimeout(function () {
        var midi = BASE + S.octave * 12 + (n[1] - 60);
        press(midi, 0.92);
        auditionTimers.push(setTimeout(function () { release(midi); }, 800));
      }, n[0] * 1000));
    });
  }

  function exportPatch() {
    var p = PRESETS[S.preset] || { name: '用户音色', en: 'USER' };
    var data = { format: 'plant1', version: PLANT.version, name: p.name, en: p.en, params: S.patch, mods: S.mods };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'plant1-' + (p.en || 'user').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
    toast('音色已导出');
  }

  var flashing = false;
  function flash() {
    if (flashing) return;
    flashing = true;
    ensureAudio();
    var steps = ['USB 握手…', '校验固件…', '写入引擎…', '写入音色…', '重启设备…'];
    var i = 0;
    var timer = setInterval(function () {
      $('sPreset').textContent = steps[i] || 'DONE';
      $('sPreset').style.color = '#fbbf24';
      i++;
      if (i > steps.length) {
        clearInterval(timer);
        $('sPreset').style.color = '';
        $('sPreset').textContent = (PRESETS[S.preset] || {}).en || 'USER';
        toast('已写入 FM-1 · 拔出 USB 后重启生效');
        flashing = false;
      }
    }, 220);
  }

  function randomPatch() {
    var rnd = function (a, b) { return a + Math.random() * (b - a); };
    var pick = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };
    var patch = PLANT.defaults();
    patch['voice.unison'] = Math.round(rnd(1, 4));
    patch['voice.detune'] = rnd(4, 40);
    patch['voice.spread'] = rnd(0.2, 1);
    patch['voice.gain'] = 0.85;
    patch['env0.a'] = rnd(0.001, 1.2);
    patch['env0.d'] = rnd(0.2, 2.5);
    patch['env0.s'] = rnd(0, 0.85);
    patch['env0.r'] = rnd(0.1, 2.2);
    var mods = [];
    var n = Math.random() < 0.5 ? 1 : 2;
    for (var i = 0; i < n; i++) {
      var t = pick([0, 0, 1, 2, 3]);
      patch['gen' + i + '.on'] = 1;
      patch['gen' + i + '.type'] = t;
      patch['gen' + i + '.level'] = 0;
      patch['gen' + i + '.pan'] = rnd(-0.6, 0.6);
      patch['gen' + i + '.tune'] = pick([-12, 0, 0, 12]);
      patch['gen' + i + '.cut'] = rnd(200, 12000);
      patch['gen' + i + '.res'] = rnd(0, 0.6);
      patch['gen' + i + '.ftype'] = Math.random() < 0.7 ? 1 : 0;
      patch['gen' + i + '.wave'] = Math.floor(rnd(0, 4));
      patch['gen' + i + '.pwm'] = rnd(0.2, 0.8);
      patch['gen' + i + '.table'] = Math.floor(rnd(0, 6));
      patch['gen' + i + '.morph'] = rnd(0, 1);
      patch['gen' + i + '.ratio'] = pick([0.5, 1, 1.5, 2, 3, 3.5, 5, 7]);
      patch['gen' + i + '.index'] = rnd(0, 6);
      patch['gen' + i + '.color'] = rnd(0, 1);
      mods.push({ src: 'env1', target: 'gen' + i + '.level', amt: rnd(0.5, 0.95) });
    }
    if (Math.random() < 0.6) mods.push({ src: 'env2', target: 'gen0.cut', amt: rnd(0.1, 0.5) });
    if (Math.random() < 0.5) mods.push({ src: pick(['lfo1', 'lfo2']), target: 'gen1.pan', amt: rnd(0.1, 0.5) });
    if (Math.random() < 0.5) mods.push({ src: 'chaos', target: 'gen0.pwm', amt: rnd(0.05, 0.3) });
    patch['lfo0.rate'] = rnd(0.05, 1.5);
    patch['lfo1.rate'] = rnd(0.05, 1.5);
    patch['flt.on'] = Math.random() < 0.5 ? 1 : 0;
    patch['flt.cut'] = rnd(500, 9000);
    patch['flt.res'] = rnd(0, 0.4);
    patch['env1.a'] = rnd(0.001, 1);
    patch['env1.d'] = rnd(0.1, 1.5);
    patch['env1.s'] = rnd(0, 0.7);
    patch['env2.a'] = rnd(0.001, 0.6);
    patch['env2.d'] = rnd(0.05, 0.8);
    patch['env2.s'] = rnd(0, 0.4);
    var fxs = [4, 5, 2, 0, 1];
    for (var f = 0; f < 3; f++) {
      patch['fx' + f + '.on'] = 1;
      patch['fx' + f + '.type'] = fxs[f];
      patch['fx' + f + '.p1'] = rnd(0.2, 0.8);
      patch['fx' + f + '.p2'] = rnd(0.2, 0.7);
      patch['fx' + f + '.p3'] = rnd(0.2, 0.7);
      patch['fx' + f + '.mix'] = rnd(0.1, 0.4);
    }
    S.patch = patch;
    S.mods = mods;
    S.patch.mods = mods;
    S.preset = -1;
    applyPatchUI();
    sendPatch();
    toast('随机音色已生成');
  }

  /* --- 顶栏动画 --- */
  function loop(now) {
    var dt = (now - (loop.last || now)) / 1000;
    loop.last = now;
    for (var l = 0; l < 2; l++) {
      lfoPhase[l] = (lfoPhase[l] + dt * lfoRate(l)) % 1;
      if (S.lfoCv && S.lfoCv[l]) drawLfo(S.lfoCv[l], l);
    }
    drawScope();
    if (S.meterBar) {
      var m = clamp(S.meter * 2.6, 0, 1);
      S.meterBar.style.width = (m * 100).toFixed(1) + '%';
    }
    $('sVoices').textContent = S.ready ? ((S.device ? 'FM-1 · ' : '') + S.voices + ' V') : '点击开启';
    requestAnimationFrame(loop);
  }

  function drawScope() {
    var cv = $('scope');
    var c = cv.getContext('2d');
    var w = cv.width, h = cv.height;
    c.clearRect(0, 0, w, h);
    c.strokeStyle = 'rgba(74,222,128,.16)';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.stroke();
    c.strokeStyle = '#4ade80';
    c.lineWidth = 2;
    c.beginPath();
    if (S.analyser) {
      if (!S.scopeBuf || S.scopeBuf.length !== S.analyser.fftSize) S.scopeBuf = new Float32Array(S.analyser.fftSize);
      var buf = S.scopeBuf;
      S.analyser.getFloatTimeDomainData(buf);
      for (var i = 0; i < w; i++) {
        var v = buf[Math.floor(i / w * buf.length)] * 1.4;
        var y = h / 2 - clamp(v, -1, 1) * (h / 2 - 3);
        if (i === 0) c.moveTo(i, y); else c.lineTo(i, y);
      }
    } else {
      c.moveTo(0, h / 2); c.lineTo(w, h / 2);
    }
    c.stroke();
  }

  /* --- 自检 API --- */
  window.PLANT1 = {
    version: PLANT.version,
    params: Object.keys(P).length,
    patch: function () { return JSON.parse(JSON.stringify({ params: S.patch, mods: S.mods })); },
    presets: PRESETS.map(function (p) { return p.name; }),
    addMod: addMod,
    setParam: setParam,
    press: press,
    release: release,
    status: function () {
      return {
        ready: S.ready,
        state: S.ctx ? S.ctx.state : null,
        mode: S.node ? (S.node.local ? 'script' : 'worklet') : null,
        voices: S.voices,
        meter: S.meter
      };
    },
    offline: function (presetIndex, seconds, midi) {
      var e = new PLANT.Engine(48000);
      var p = PRESETS[presetIndex];
      var patch = Object.assign(PLANT.defaults(), p.params, { mods: p.mods || [] });
      e.setPatch(patch);
      var t0 = performance.now();
      var res = e.renderOffline(seconds || 2, [{ t: 0.02, on: true, midi: midi || 60, vel: 0.9 }]);
      var L = res[0], R = res[1];
      var peak = 0, sum = 0, nan = 0;
      for (var i = 0; i < L.length; i++) {
        var a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
        if (!isFinite(L[i]) || !isFinite(R[i])) nan++;
        if (a > peak) peak = a;
        sum += L[i] * L[i] + R[i] * R[i];
      }
      return { name: p.name, peak: peak, rms: Math.sqrt(sum / (L.length * 2)), nan: nan, ms: performance.now() - t0 };
    }
  };

  /* --- 启动 --- */
  buildVoice();
  buildFilter();
  buildGens();
  buildMods();
  buildFx();
  buildKeyboard();
  bindHeader();
  bindKeyboard();
  bindComputerKeys();
  bindMidi();
  renderMatrix();

  if (loadLocal()) {
    applyPatchUI();
    toast('已恢复上次的音色');
  } else {
    loadPreset(0, true);
  }
  updateHold();
  requestAnimationFrame(loop);

  window.addEventListener('resize', function () { refreshAllKnobs(); });
  ['pointerdown', 'keydown'].forEach(function (ev) {
    var once = function () { ensureAudio(); window.removeEventListener(ev, once); };
    window.addEventListener(ev, once);
  });
})();
