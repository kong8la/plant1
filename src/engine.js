/* ============================================================================
 * PLANT-1  ·  Phase-Plant 风格模块化合成器引擎（M-VAVE FM-1 固件模拟）
 * ----------------------------------------------------------------------------
 * 纯 JS DSP，不碰 DOM，可同时跑在 AudioWorklet 和 Node 测试里。
 * 结构：4 个发生器槽（模拟/波表/FM/噪声）→ 各自滤波 → 声部总线 → 全局滤波
 *       → 5 个效果槽 → 主输出。调制矩阵把 8 个调制源连到任意浮点参数上。
 * ==========================================================================*/
(function (root) {
  'use strict';

  var TAU = Math.PI * 2;
  var CHUNK = 16;          // 控制率：每 16 个采样更新一次调制/滤波系数
  var TSIZE = 1024;        // 波表长度
  var MASK = TSIZE - 1;

  /* ------------------------------------------------------------------ 参数 */
  var P = {};
  var NSLOT = 0;

  function D(id, min, max, def, o) {
    o = o || {};
    var kind = o.kind || 'float';
    var d = {
      id: id, min: min, max: max, def: def,
      curve: o.curve || 'lin',
      kind: kind,
      label: o.label || id,
      en: o.en || id,
      unit: o.unit || '',
      values: o.values || null,
      mod: kind === 'float' && o.mod !== false,
      slot: -1
    };
    if (d.mod) d.slot = NSLOT++;
    P[id] = d;
    return d;
  }

  function toNorm(d, v) {
    if (d.curve === 'log') {
      v = Math.max(d.min, Math.min(d.max, v));
      return Math.log(v / d.min) / Math.log(d.max / d.min);
    }
    return (v - d.min) / (d.max - d.min);
  }
  function fromNorm(d, n) {
    n = n < 0 ? 0 : n > 1 ? 1 : n;
    if (d.curve === 'log') return d.min * Math.pow(d.max / d.min, n);
    return d.min + (d.max - d.min) * n;
  }

  var GEN_TYPES = ['模拟', '波表', 'FM', '噪声'];
  var GEN_TYPES_EN = ['ANALOG', 'WAVETABLE', 'FM', 'NOISE'];
  var WAVES = ['锯齿', '方波', '脉冲', '正弦'];
  var WAVES_EN = ['SAW', 'SQUARE', 'PULSE', 'SINE'];
  var FTYPES = ['关', '低通', '高通', '带通', '陷波'];
  var FTYPES_EN = ['OFF', 'LP', 'HP', 'BP', 'NOTCH'];
  var LFO_SHAPES = ['正弦', '三角', '上锯', '下锯', '方波', '随机', '平滑随机'];
  var LFO_DIVS = ['4 小节', '2 小节', '1 小节', '1/2', '1/4', '1/8', '1/16', '1/32'];
  var FX_TYPES = ['驱动', '降位', '合唱', '移相', '延迟', '混响', '均衡', '压缩', '滤波', '立体声'];
  var FX_EN = ['DRIVE', 'CRUSH', 'CHORUS', 'PHASER', 'DELAY', 'REVERB', 'EQ', 'COMP', 'FILTER', 'WIDTH'];

  D('voice.poly', 1, 16, 8, { kind: 'int', label: '复音', en: 'POLY' });
  D('voice.unison', 1, 5, 1, { kind: 'int', label: '齐奏', en: 'UNISON' });
  D('voice.detune', 0, 60, 14, { label: '失谐', en: 'DETUNE', unit: '¢', mod: false });
  D('voice.spread', 0, 1, 0.6, { label: '展宽', en: 'SPREAD', mod: false });
  D('voice.glide', 0, 400, 0, { label: '滑音', en: 'GLIDE', unit: 'ms', mod: false });
  D('voice.bend', 1, 24, 2, { kind: 'int', label: '弯音', en: 'BEND', unit: 'st' });
  D('voice.gain', 0, 1.5, 0.8, { label: '总音量', en: 'VOLUME', mod: false });

  for (var g = 0; g < 4; g++) {
    D('gen' + g + '.on', 0, 1, g === 0 ? 1 : 0, { kind: 'int', label: '启用', en: 'ON' });
    D('gen' + g + '.type', 0, 3, g === 0 ? 0 : 1, { kind: 'enum', label: '类型', en: 'TYPE', values: GEN_TYPES });
    D('gen' + g + '.level', 0, 1.4, 0.8, { label: '电平', en: 'LEVEL' });
    D('gen' + g + '.pan', -1, 1, 0, { label: '声像', en: 'PAN' });
    D('gen' + g + '.tune', -36, 36, 0, { label: '音高', en: 'TUNE', unit: 'st' });
    D('gen' + g + '.cut', 30, 18000, 18000, { curve: 'log', label: '截止', en: 'CUTOFF', unit: 'Hz' });
    D('gen' + g + '.res', 0, 1, 0.15, { label: '共振', en: 'RESO' });
    D('gen' + g + '.ftype', 0, 4, 0, { kind: 'enum', label: '滤波', en: 'FILTER', values: FTYPES });
    D('gen' + g + '.wave', 0, 3, 0, { kind: 'enum', label: '波形', en: 'WAVE', values: WAVES });
    D('gen' + g + '.pwm', 0.05, 0.95, 0.5, { label: '脉宽', en: 'PWM' });
    D('gen' + g + '.table', 0, 5, 0, { kind: 'int', label: '波表', en: 'TABLE' });
    D('gen' + g + '.morph', 0, 1, 0, { label: '形变', en: 'MORPH' });
    D('gen' + g + '.ratio', 0.25, 16, 1, { curve: 'log', label: '比率', en: 'RATIO' });
    D('gen' + g + '.index', 0, 16, 2, { label: '指数', en: 'INDEX' });
    D('gen' + g + '.fb', 0, 1, 0, { label: '反馈', en: 'FEEDBACK' });
    D('gen' + g + '.color', 0, 1, 0.4, { label: '色温', en: 'COLOR' });
  }

  D('flt.on', 0, 1, 0, { kind: 'int', label: '启用', en: 'ON' });
  D('flt.type', 0, 4, 1, { kind: 'enum', label: '类型', en: 'TYPE', values: FTYPES });
  D('flt.cut', 30, 18000, 7000, { curve: 'log', label: '截止', en: 'CUTOFF', unit: 'Hz' });
  D('flt.res', 0, 1, 0.15, { label: '共振', en: 'RESO' });
  D('flt.drive', 0, 1, 0, { label: '过载', en: 'DRIVE' });

  for (var e = 0; e < 3; e++) {
    D('env' + e + '.a', 0.001, 8, e === 0 ? 0.004 : 0.4, { curve: 'log', label: '起音', en: 'ATTACK', unit: 's' });
    D('env' + e + '.d', 0.002, 8, e === 0 ? 0.9 : 1.2, { curve: 'log', label: '衰减', en: 'DECAY', unit: 's' });
    D('env' + e + '.s', 0, 1, e === 0 ? 0.0 : 0.7, { label: '延持', en: 'SUSTAIN' });
    D('env' + e + '.r', 0.002, 10, e === 0 ? 0.35 : 1.6, { curve: 'log', label: '释放', en: 'RELEASE', unit: 's' });
    D('env' + e + '.curve', -1, 1, 0, { label: '曲线', en: 'CURVE' });
    D('env' + e + '.vel', 0, 1, 0.6, { label: '力度', en: 'VELO', mod: false });
  }

  for (var l = 0; l < 2; l++) {
    D('lfo' + l + '.rate', 0.02, 40, l === 0 ? 1.2 : 0.25, { curve: 'log', label: '速率', en: 'RATE', unit: 'Hz', mod: false });
    D('lfo' + l + '.shape', 0, 6, l, { kind: 'enum', label: '波形', en: 'SHAPE', values: LFO_SHAPES });
    D('lfo' + l + '.sync', 0, 1, 0, { kind: 'int', label: '同步', en: 'SYNC' });
    D('lfo' + l + '.div', 0, 7, 4, { kind: 'enum', label: '分频', en: 'DIV', values: LFO_DIVS });
    D('lfo' + l + '.phase', 0, 1, 0, { label: '相位', en: 'PHASE', mod: false });
    D('lfo' + l + '.amp', 0, 1, 1, { label: '幅度', en: 'AMOUNT', mod: false });
    D('lfo' + l + '.uni', 0, 1, 0, { kind: 'int', label: '单极', en: 'UNI' });
  }

  D('chaos.rate', 0.02, 8, 0.6, { curve: 'log', label: '速率', en: 'RATE', unit: 'Hz', mod: false });
  D('chaos.smooth', 0, 1, 0.6, { label: '平滑', en: 'SMOOTH', mod: false });
  D('macro.val', 0, 1, 0.5, { label: '宏控', en: 'MACRO', mod: false });

  for (var f = 0; f < 5; f++) {
    D('fx' + f + '.on', 0, 1, 0, { kind: 'int', label: '启用', en: 'ON' });
    D('fx' + f + '.type', 0, 9, f, { kind: 'enum', label: '类型', en: 'TYPE', values: FX_TYPES });
    D('fx' + f + '.p1', 0, 1, 0.5, { label: 'A', en: 'A' });
    D('fx' + f + '.p2', 0, 1, 0.5, { label: 'B', en: 'B' });
    D('fx' + f + '.p3', 0, 1, 0.5, { label: 'C', en: 'C' });
    D('fx' + f + '.mix', 0, 1, 0.35, { label: '混合', en: 'MIX' });
  }

  D('tempo', 40, 200, 120, { kind: 'int', label: '速度', en: 'BPM' });

  var MOD_SOURCES = ['env1', 'env2', 'env3', 'lfo1', 'lfo2', 'chaos', 'macro', 'vel', 'key', 'mw', 'at', 'rnd'];
  var MOD_LABELS = ['包络 1', '包络 2', '包络 3', 'LFO 1', 'LFO 2', '混沌', '宏控', '力度', '键位', '调制轮', '触后', '随机'];
  var SOURCE_COLORS = ['#a78bfa', '#a78bfa', '#a78bfa', '#c084fc', '#c084fc', '#f472b6', '#fbbf24', '#38bdf8', '#38bdf8', '#38bdf8', '#38bdf8', '#f472b6'];

  /* ---------------------------------------------------------------- 波表库 */
  var TABLES = null;

  function buildTables() {
    var specs = [
      // [名称, 帧A 谐波表, 帧B 谐波表]  谐波振幅按 h=1..64 索引
      ['锯齿/方波', hs(function (h) { return 1 / h; }, 64), hs(function (h) { return h % 2 ? 1 / h : 0; }, 64)],
      ['正弦/三角', hs(function (h) { return h === 1 ? 1 : 0; }, 64), hs(function (h) { return h % 2 ? 1 / (h * h) * (h % 4 === 1 ? 1 : -1) : 0; }, 64)],
      ['管风琴', hs(function (h) { return [1, 0.5, 0, 0.3, 0, 0, 0, 0.18][h - 1] || 0; }, 8), hs(function (h) { return Math.pow(h, -0.7); }, 32)],
      ['人声', hs(function (h) { return Math.exp(-Math.pow((h - 3) / 3, 2)) * 0.8 + Math.exp(-Math.pow((h - 8) / 4, 2)) * 0.5; }, 32), hs(function (h) { return Math.exp(-Math.pow((h - 5) / 4, 2)) * 0.7 + Math.exp(-Math.pow((h - 14) / 6, 2)) * 0.5; }, 48)],
      ['金属', hs(function (h) { return (h % 2 || h % 3 === 0) ? 1 / Math.pow(h, 0.8) : 0; }, 48), hs(function (h) { return [1, 0, 0.8, 0, 0.6, 0, 0, 0.5, 0, 0, 0, 0.4][h - 1] || 0; }, 16)],
      ['数字', hs(function (h) { return (h % 4 === 1) ? 1 / Math.sqrt(h) : (h % 4 === 3 ? -1 / Math.sqrt(h) : 0); }, 64), hs(function (h) { return Math.pow(h, -0.5) * (h % 2 ? 1 : 0.4); }, 64)]
    ];
    var mipH = [64, 32, 16, 8, 4, 2];
    TABLES = specs.map(function (s) {
      var frames = [s[1], s[2]].map(function (amps) {
        var mips = mipH.map(function (maxH) {
          var buf = new Float32Array(TSIZE);
          for (var h = 1; h <= maxH; h++) {
            var amp = amps[h - 1] || 0;
            if (!amp) continue;
            genHarmonic(buf, h, amp, h * 1.7);
          }
          normalize(buf);
          return buf;
        });
        return mips;
      });
      return { name: s[0], a: frames[0], b: frames[1] };
    });
    return TABLES;
  }

  function hs(fn, count) {
    var out = new Array(count);
    for (var h = 1; h <= count; h++) out[h - 1] = fn(h);
    return out;
  }

  function genHarmonic(buf, h, amp, ph) {
    var w = TAU * h / TSIZE;
    var cs = Math.cos(w), sn = Math.sin(w);
    var re = Math.cos(ph), im = Math.sin(ph);
    for (var i = 0; i < TSIZE; i++) {
      buf[i] += amp * im;
      var nr = re * cs - im * sn;
      im = re * sn + im * cs;
      re = nr;
    }
  }

  function normalize(buf) {
    var peak = 1e-6;
    for (var i = 0; i < buf.length; i++) { var a = Math.abs(buf[i]); if (a > peak) peak = a; }
    var k = 1 / peak;
    for (var j = 0; j < buf.length; j++) buf[j] *= k;
  }

  /* --------------------------------------------------------------- 基础 DSP */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function midiHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function SVF(mode) {
    this.ic1 = 0; this.ic2 = 0;
    this.a1 = 0; this.a2 = 0; this.a3 = 0; this.k = 1; this.mode = mode;
  }
  SVF.prototype.set = function (cut, res, sr) {
    cut = clamp(cut, 18, sr * 0.45);
    var gg = Math.tan(Math.PI * cut / sr);
    var k = 2 - 1.92 * clamp(res, 0, 0.99);
    this.k = k;
    var a1 = 1 / (1 + gg * (gg + k));
    this.a1 = a1; this.a2 = gg * a1; this.a3 = gg * this.a2;
  };
  SVF.prototype.process = function (x) {
    var v3 = x - this.ic2;
    var v1 = this.a1 * this.ic1 + this.a2 * v3;
    var v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    switch (this.mode) {
      case 1: return v2;
      case 2: return x - this.k * v1 - v2;
      case 3: return v1;
      case 4: return x - this.k * v1;
      default: return x;
    }
  };
  SVF.prototype.reset = function () { this.ic1 = 0; this.ic2 = 0; };

  function polyblep(t, dt) {
    if (t < dt) { t /= dt; return t + t - t * t - 1; }
    if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
    return 0;
  }

  /* ------------------------------------------------------------- 包络/LFO */
  function Env() {
    this.v = 0; this.stage = 0; this.a = 0.005; this.d = 0.5; this.s = 0.8; this.r = 0.3;
    this.curve = 0; this.vel = 0;
  }
  Env.prototype.set = function (a, d, s, r, curve) {
    this.a = Math.max(0.0005, a); this.d = Math.max(0.0005, d);
    this.s = clamp(s, 0, 1); this.r = Math.max(0.0005, r); this.curve = curve;
  };
  Env.prototype.gate = function (on) {
    if (on) { this.stage = 1; }
    else if (this.stage !== 0 && this.stage !== 4) { this.stage = 4; }
  };
  Env.prototype.reset = function () { this.v = 0; this.stage = 0; };
  Env.prototype.tick = function (dt) {
    // 时间常数按标称时间标定：attack 到顶≈a，decay 到 s≈d，release 到 -60dB≈r
    var sh = this.curve > 0 ? 1 / (1 + this.curve * 2) : 1 + (-this.curve) * 2;
    var v = this.v;
    if (this.stage === 1) {
      var ca = 1 - Math.exp(-dt / (this.a * 0.585 * sh + 0.0003));
      v += (1.22 - v) * ca;
      if (v >= 1) { v = 1; this.stage = 2; }
    } else if (this.stage === 2) {
      var cd = 1 - Math.exp(-dt / (this.d * 0.22 * sh + 0.0003));
      v += (this.s - v) * cd;
      if (Math.abs(v - this.s) < 0.0015) { v = this.s; this.stage = this.s < 0.0005 ? 0 : 3; }
    } else if (this.stage === 3) {
      v = this.s;
    } else if (this.stage === 4) {
      var cr = 1 - Math.exp(-dt / (this.r * 0.135 / sh + 0.0003));
      v += (0 - v) * cr;
      if (v < 0.0006) { v = 0; this.stage = 0; }
    } else {
      v = 0;
    }
    this.v = v;
    return v;
  };
  Env.prototype.busy = function () { return this.stage !== 0; };

  function Lfo() {
    this.ph = 0; this.shape = 0; this.rate = 1; this.amp = 1; this.uni = 0;
    this.rnd = Math.random(); this.smooth = 0; this.glide = 0;
  }
  Lfo.prototype.tick = function (dt) {
    var prev = this.ph;
    this.ph += dt * this.rate;
    if (this.ph >= 1) {
      this.ph -= Math.floor(this.ph);
      this.stepVal = Math.random() * 2 - 1;
    }
    var p = this.ph, v;
    switch (this.shape) {
      case 0: v = Math.sin(p * TAU); break;
      case 1: v = 1 - 4 * Math.abs(p - 0.5); break;
      case 2: v = p * 2 - 1; break;
      case 3: v = 1 - p * 2; break;
      case 4: v = p < 0.5 ? 1 : -1; break;
      case 5: v = this.stepVal || 0; break;
      case 6:
        this.smooth += ((this.stepVal || 0) - this.smooth) * clamp(dt * 6, 0, 1);
        v = this.smooth;
        break;
      default: v = 0;
    }
    this.out = (this.uni ? (v * 0.5 + 0.5) : v) * this.amp;
    return this.out;
  };
  Lfo.prototype.resetPhase = function (ph) { this.ph = ph || 0; this.stepVal = Math.random() * 2 - 1; this.smooth = 0; this.out = 0; };

  function Chaos() {
    this.v = 0; this.s1 = 0; this.s2 = 0; this.rate = 0.6; this.smooth = 0.6;
  }
  Chaos.prototype.tick = function (dt) {
    var n = Math.random() * 2 - 1;
    var a = clamp(dt * this.rate * 12, 0.0001, 1);
    this.s1 += (n - this.s1) * a;
    this.s2 += (this.s1 - this.s2) * a * (0.4 + this.smooth * 2);
    this.v = clamp(this.s2 * 1.6, -1, 1);
    return this.v;
  };

  /* ------------------------------------------------------------------ 声部 */
  function Voice(eng) {
    this.eng = eng;
    this.active = false;
    this.midi = 60; this.vel = 1; this.age = 0; this.rnd = 0;
    this.phase = new Float32Array(20);     // 4 槽 × 5 齐奏
    this.mphase = new Float32Array(4);
    this.fbprev = new Float32Array(4);
    this.pinkLp = new Float32Array(4);
    this.filt = [new SVF(1), new SVF(1), new SVF(1), new SVF(1)];
    this.gfilt = new SVF(1);
    this.envs = [new Env(), new Env(), new Env()];
    this.lfos = [new Lfo(), new Lfo()];
    this.chaos = new Chaos();
    this.mod = new Float32Array(NSLOT);
    this.src = new Float32Array(12);
    this.gp = [{}, {}, {}, {}];
    this.step = new Float32Array(20);
    this.pL = new Float32Array(20);
    this.pR = new Float32Array(20);
    this.lvlPrev = new Float32Array(4);
    this.bufL = new Float32Array(32);
    this.bufR = new Float32Array(32);
    this.tmpL = new Float32Array(32);
    this.tmpR = new Float32Array(32);
    this.freq = 60;
    this.target = 60;
  }
  Voice.prototype.start = function (midi, vel, poly) {
    this.midi = midi;
    this.vel = vel;
    this.active = true;
    this.rnd = Math.random() * 2 - 1;
    this.target = midi;
    if (!this.eng.glideActive) this.freq = midi;
    for (var i = 0; i < this.phase.length; i++) this.phase[i] = Math.random();
    this.mphase[0] = Math.random(); this.fbprev[0] = 0;
    for (var e = 0; e < 3; e++) this.envs[e].gate(true);
    for (var l = 0; l < 2; l++) this.lfos[l].resetPhase(this.eng.patch['lfo' + l + '.phase']);
    for (var f = 0; f < 4; f++) { this.filt[f].reset(); this.lvlPrev[f] = 0; this.pinkLp[f] = 0; }
    this.gfilt.reset();
  };
  Voice.prototype.release = function () {
    for (var e = 0; e < 3; e++) this.envs[e].gate(false);
  };
  Voice.prototype.kill = function () {
    this.active = false;
    for (var e = 0; e < 3; e++) this.envs[e].reset();
  };

  /* ------------------------------------------------------------------ 效果 */
  function makeFx(type, sr) {
    var f = { type: type, sr: sr, p1: 0.5, p2: 0.5, p3: 0.5, mix: 0.3, st: {} };
    if (type === 2) { // chorus
      f.st.bufL = new Float32Array(sr * 2 | 0); f.st.bufR = new Float32Array(sr * 2 | 0);
      f.st.w = 0; f.st.ph = 0;
    } else if (type === 3) { // phaser
      f.st.apL = [0, 0, 0, 0, 0, 0]; f.st.apR = [0, 0, 0, 0, 0, 0]; f.st.ph = 0;
    } else if (type === 4) { // delay
      var d = sr * 1.2 | 0;
      f.st.bufL = new Float32Array(d); f.st.bufR = new Float32Array(d);
      f.st.w = 0; f.st.lpL = 0; f.st.lpR = 0;
    } else if (type === 5) { // reverb
      var combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
      var aps = [556, 441, 341, 225];
      f.st.combL = []; f.st.combR = []; f.st.apL = []; f.st.apR = [];
      for (var i = 0; i < 8; i++) {
        var cl = Math.round(combs[i] * sr / 44100), cr = Math.round((combs[i] + 23) * sr / 44100);
        f.st.combL.push({ b: new Float32Array(cl), w: 0, lp: 0 });
        f.st.combR.push({ b: new Float32Array(cr), w: 0, lp: 0 });
      }
      for (var j = 0; j < 4; j++) {
        var al = Math.round(aps[j] * sr / 44100), ar = Math.round((aps[j] + 19) * sr / 44100);
        f.st.apL.push({ b: new Float32Array(al), w: 0 });
        f.st.apR.push({ b: new Float32Array(ar), w: 0 });
      }
    } else if (type === 6) { // eq tilt
      f.st.xl = 0; f.st.xr = 0; f.st.lL = 0; f.st.lR = 0;
    } else if (type === 7) { // comp
      f.st.env = 0;
    } else if (type === 8) { // filter
      f.st.fl = new SVF(1); f.st.fr = new SVF(1);
    } else if (type === 0) { // drive
      f.st.lpL = 0; f.st.lpR = 0;
    }
    return f;
  }

  /* ------------------------------------------------------------------ 引擎 */
  function Engine(sr) {
    this.sr = sr || 48000;
    if (!TABLES) buildTables();
    this.patch = {};
    for (var id in P) this.patch[id] = P[id].def;
    this.voices = [];
    for (var i = 0; i < 16; i++) this.voices.push(new Voice(this));
    this.ghost = new Voice(this);
    this.c = null;
    this.fxs = [];
    this.bend = 0;
    this.mw = 0;
    this.at = 0;
    this.glideActive = false;
    this.noteCounter = 0;
    this.gmod = new Float32Array(NSLOT);
    this.dcXl = 0; this.dcXr = 0; this.dcYl = 0; this.dcYr = 0;
    this.gainS = 0.8;
    this.meter = 0;
    this.muteGain = 1;
    this.muteTarget = 1;
    this._pendingPatch = null;
    this._panicPending = false;
    this.activeVoices = 0;
    this.compile();
  }

  Engine.prototype.setPatch = function (patch) {
    // 有音在响时先做 4ms 淡出，再换音色，避免切换爆音
    if ((this.activeVoices || 0) > 0) {
      this._pendingPatch = patch;
      this.muteTarget = 0;
    } else {
      this.applyPatch(patch);
    }
  };
  Engine.prototype.applyPatch = function (patch) {
    for (var id in P) {
      var v = patch[id];
      this.patch[id] = (typeof v === 'number' && isFinite(v)) ? v : P[id].def;
    }
    if (patch.mods && typeof patch.mods.length === 'number') this.patch.__mods = patch.mods.slice();
    this.compile();
  };
  Engine.prototype.setParam = function (id, v) {
    if (!P[id]) return;
    if (P[id].kind === 'int' || P[id].kind === 'enum') v = Math.round(v);
    v = clamp(v, P[id].min, P[id].max);
    this.patch[id] = v;
    this.compile();
  };
  Engine.prototype.setMods = function (mods) {
    this.patch.__mods = mods || [];
    this.compile();
  };

  Engine.prototype.compile = function () {
    var sr = this.sr, pt = this.patch;
    var c = { sr: sr, base: new Float32Array(NSLOT), gens: [], envs: [], lfos: [] };

    c.poly = clamp(Math.round(pt['voice.poly']), 1, 16);
    c.unison = clamp(Math.round(pt['voice.unison']), 1, 5);
    c.detune = pt['voice.detune'];
    c.spread = pt['voice.spread'];
    c.glide = pt['voice.glide'] / 1000;
    c.bendRange = pt['voice.bend'];

    for (var g = 0; g < 4; g++) {
      c.gens.push({
        on: !!Math.round(pt['gen' + g + '.on']),
        type: Math.round(pt['gen' + g + '.type']),
        level: pt['gen' + g + '.level'],
        pan: pt['gen' + g + '.pan'],
        tune: pt['gen' + g + '.tune'],
        cut: pt['gen' + g + '.cut'],
        res: pt['gen' + g + '.res'],
        ftype: Math.round(pt['gen' + g + '.ftype']),
        wave: Math.round(pt['gen' + g + '.wave']),
        pwm: pt['gen' + g + '.pwm'],
        table: clamp(Math.round(pt['gen' + g + '.table']), 0, TABLES.length - 1),
        morph: pt['gen' + g + '.morph'],
        ratio: pt['gen' + g + '.ratio'],
        index: pt['gen' + g + '.index'],
        fb: pt['gen' + g + '.fb'],
        color: pt['gen' + g + '.color'],
        tab: TABLES[clamp(Math.round(pt['gen' + g + '.table']), 0, TABLES.length - 1)]
      });
    }
    c.flt = {
      on: !!Math.round(pt['flt.on']), type: Math.round(pt['flt.type']),
      cut: pt['flt.cut'], res: pt['flt.res'], drive: pt['flt.drive']
    };
    for (var e = 0; e < 3; e++) {
      c.envs.push({
        a: pt['env' + e + '.a'], d: pt['env' + e + '.d'], s: pt['env' + e + '.s'],
        r: pt['env' + e + '.r'], curve: pt['env' + e + '.curve'], vel: pt['env' + e + '.vel']
      });
    }
    for (var l = 0; l < 2; l++) {
      c.lfos.push({
        rate: pt['lfo' + l + '.rate'], shape: Math.round(pt['lfo' + l + '.shape']),
        sync: !!Math.round(pt['lfo' + l + '.sync']), div: Math.round(pt['lfo' + l + '.div']),
        phase: pt['lfo' + l + '.phase'], amp: pt['lfo' + l + '.amp'],
        uni: !!Math.round(pt['lfo' + l + '.uni'])
      });
    }
    c.chaos = { rate: pt['chaos.rate'], smooth: pt['chaos.smooth'] };
    c.macro = pt['macro.val'];
    c.tempo = pt['tempo'];
    c.gain = pt['voice.gain'];

    // 基础值归一化（供调制使用）
    for (var id in P) {
      var d = P[id];
      if (d.slot >= 0) c.base[d.slot] = toNorm(d, pt[id]);
    }

    // 效果链
    var fxs = [];
    for (var i = 0; i < 5; i++) {
      var t = Math.round(pt['fx' + i + '.type']);
      var fx = this.fxs[i];
      if (!fx || fx.type !== t) fx = makeFx(t, sr);
      fx.on = !!Math.round(pt['fx' + i + '.on']);
      fx.p1 = pt['fx' + i + '.p1'];
      fx.p2 = pt['fx' + i + '.p2'];
      fx.p3 = pt['fx' + i + '.p3'];
      fx.mix = pt['fx' + i + '.mix'];
      fx.slotBase = [P['fx' + i + '.p1'].slot, P['fx' + i + '.p2'].slot, P['fx' + i + '.p3'].slot, P['fx' + i + '.mix'].slot];
      fxs.push(fx);
    }
    this.fxs = fxs;

    // 调制矩阵
    var mods = [];
    var raw = this.patch.__mods || [];
    for (var m = 0; m < raw.length; m++) {
      var it = raw[m];
      var pd = P[it.target];
      if (!pd || pd.slot < 0) continue;
      var si = MOD_SOURCES.indexOf(it.src);
      if (si < 0) continue;
      mods.push({ si: si, slot: pd.slot, amt: clamp(it.amt, -1, 1) });
    }
    c.mods = mods;
    c.modSlots = new Uint8Array(NSLOT);
    for (var k = 0; k < mods.length; k++) c.modSlots[mods[k].slot] = 1;
    this.c = c;
    this.glideActive = c.glide > 0.0005;
  };

  /* 取声部参数：基础 + 调制 */
  Engine.prototype.val = function (voice, id) {
    var d = P[id];
    if (d.slot < 0) return this.patch[id];
    var base = this.c.base[d.slot];
    return fromNorm(d, base + voice.mod[d.slot]);
  };

  Engine.prototype.noteOn = function (midi, vel) {
    var c = this.c;
    var free = null, oldest = null, maxAge = -1, count = 0;
    for (var i = 0; i < 16; i++) {
      var v = this.voices[i];
      if (v.active) {
        count++;
        if (v.age > maxAge) { maxAge = v.age; oldest = v; }
      } else if (!free) free = v;
    }
    // 超过复音数就抢占最老的声部
    var use = (count >= c.poly) ? oldest : (free || oldest);
    if (!use) return;
    use.age = this.noteCounter++;
    use.start(midi, vel, c.poly);
    if (!this.glideActive) use.freq = midi;
    this.lastVoice = use;
  };
  Engine.prototype.noteOff = function (midi) {
    for (var i = 0; i < 16; i++) {
      var v = this.voices[i];
      if (v.active && v.midi === midi && v.envs[0].stage !== 4) v.release();
    }
  };
  Engine.prototype.allOff = function () {
    for (var i = 0; i < 16; i++) this.voices[i].kill();
    // 先淡出，再清效果器尾音
    this.muteTarget = 0;
    this._panicPending = true;
  };
  Engine.prototype.setBend = function (v) { this.bend = clamp(v, -1, 1); };
  Engine.prototype.setModWheel = function (v) { this.mw = clamp(v, 0, 1); };
  Engine.prototype.setAftertouch = function (v) { this.at = clamp(v, 0, 1); };

  /* -------------------------------------------------------------- 声部渲染 */
  Voice.prototype.updateMods = function (eng, dt) {
    var c = eng.c, sr = eng.sr;
    var e0 = c.envs;
    for (var e = 0; e < 3; e++) {
      var env = this.envs[e];
      env.set(e0[e].a, e0[e].d, e0[e].s, e0[e].r, e0[e].curve);
      env.tick(dt);
    }
    for (var l = 0; l < 2; l++) {
      var lo = this.lfos[l], lc = c.lfos[l];
      lo.shape = lc.shape;
      lo.amp = lc.amp;
      lo.uni = lc.uni;
      var rate = lc.rate;
      if (lc.sync) {
        var bpm = c.tempo, beats = [16, 8, 4, 2, 1, 0.5, 0.25, 0.125][lc.div] || 1;
        rate = (bpm / 60) / beats;
      }
      lo.rate = rate;
      lo.tick(dt);
    }
    var ch = this.chaos;
    ch.rate = c.chaos.rate; ch.smooth = c.chaos.smooth;
    ch.tick(dt);

    var s = this.src;
    var v0 = this.vel;
    s[0] = this.envs[0].v * (1 - e0[0].vel + e0[0].vel * v0);
    s[1] = this.envs[1].v * (1 - e0[1].vel + e0[1].vel * v0);
    s[2] = this.envs[2].v * (1 - e0[2].vel + e0[2].vel * v0);
    s[3] = this.lfos[0].out;
    s[4] = this.lfos[1].out;
    s[5] = ch.v;
    s[6] = c.macro;
    s[7] = this.vel;
    s[8] = clamp((this.midi - 60) / 36, -1, 1);
    s[9] = eng.mw;
    s[10] = eng.at;
    s[11] = this.rnd;

    this.mod.fill(0);
    for (var m = 0; m < c.mods.length; m++) {
      var mm = c.mods[m];
      this.mod[mm.slot] += mm.amt * s[mm.si];
    }
  };

  Voice.prototype.render = function (eng, L, R, off, len) {
    var c = eng.c, sr = eng.sr, dt = len / sr;
    this.age++;

    var bend = eng.bend * c.bendRange;
    var glideCoef = c.glide > 0.0005 ? 1 - Math.exp(-dt / Math.max(0.0008, c.glide * 0.25)) : 1;
    this.freq += (this.target - this.freq) * glideCoef;
    this.updateMods(eng, dt);

    var nUni = c.unison, detune = c.detune, spread = c.spread;
    var noteFreq = midiHz(this.freq + bend);
    var gens = c.gens, gp = this.gp;
    var step = this.step, pL = this.pL, pR = this.pR;
    var s, g, u;

    var bufL = this.bufL, bufR = this.bufR;
    for (s = 0; s < len; s++) { bufL[s] = 0; bufR[s] = 0; }
    var gk = nUni > 1 ? 1 / Math.sqrt(nUni) : 1;

    for (g = 0; g < 4; g++) {
      var G = gens[g], q = gp[g];
      q.on = G.on; q.type = G.type; q.wave = G.wave; q.ftype = G.ftype; q.tab = G.tab;
      if (!G.on) { this.lvlPrev[g] = 0; continue; }

      q.lvl = clamp(eng.val(this, 'gen' + g + '.level'), 0, 1.4);
      q.pan = clamp(eng.val(this, 'gen' + g + '.pan'), -1, 1);
      q.tune = eng.val(this, 'gen' + g + '.tune');
      q.cut = eng.val(this, 'gen' + g + '.cut');
      q.res = clamp(eng.val(this, 'gen' + g + '.res'), 0, 0.99);
      q.morph = clamp(eng.val(this, 'gen' + g + '.morph'), 0, 1);
      q.idx = clamp(eng.val(this, 'gen' + g + '.index'), 0, 24);
      q.pwm = clamp(eng.val(this, 'gen' + g + '.pwm'), 0.02, 0.98);
      q.ratio = clamp(eng.val(this, 'gen' + g + '.ratio'), 0.1, 32);
      q.fb = clamp(eng.val(this, 'gen' + g + '.fb'), 0, 1);
      q.color = clamp(eng.val(this, 'gen' + g + '.color'), 0, 1);
      q.lvlA = this.lvlPrev[g];
      q.lvlB = q.lvl;
      this.lvlPrev[g] = q.lvl;

      var fbase = noteFreq * Math.pow(2, q.tune / 12);
      for (u = 0; u < nUni; u++) {
        var sp = nUni === 1 ? 0 : (u / (nUni - 1) * 2 - 1);
        step[g * 5 + u] = (fbase * Math.pow(2, (sp * detune) / 1200)) / sr;
        var pan = clamp(q.pan + sp * spread, -1, 1);
        pL[g * 5 + u] = Math.cos((pan + 1) * Math.PI * 0.25) * gk;
        pR[g * 5 + u] = Math.sin((pan + 1) * Math.PI * 0.25) * gk;
      }

      var filt = this.filt[g];
      if (q.ftype) { filt.mode = q.ftype; filt.set(q.cut, q.res, sr); }

      var tL = this.tmpL, tR = this.tmpR;
      for (s = 0; s < len; s++) { tL[s] = 0; tR[s] = 0; }

      if (q.type === 0) {                       /* ---- 模拟振荡器 ---- */
        var w = q.wave, pw = q.pwm;
        for (u = 0; u < nUni; u++) {
          var pi2 = g * 5 + u, ph = this.phase[pi2], dtp = step[pi2];
          var pl = pL[pi2], pr = pR[pi2], o = 0;
          if (w === 3) {
            for (s = 0; s < len; s++) {
              o = Math.sin(ph * TAU); tL[s] += o * pl; tR[s] += o * pr;
              ph += dtp; if (ph >= 1) ph -= 1;
            }
          } else if (w === 0) {
            for (s = 0; s < len; s++) {
              o = 2 * ph - 1 - polyblep(ph, dtp); tL[s] += o * pl; tR[s] += o * pr;
              ph += dtp; if (ph >= 1) ph -= 1;
            }
          } else if (w === 1) {
            for (s = 0; s < len; s++) {
              var b2 = ph + 0.5; if (b2 >= 1) b2 -= 1;
              o = (ph < 0.5 ? 1 : -1) + polyblep(ph, dtp) - polyblep(b2, dtp);
              tL[s] += o * pl; tR[s] += o * pr;
              ph += dtp; if (ph >= 1) ph -= 1;
            }
          } else {
            for (s = 0; s < len; s++) {
              var edge = ph + 1 - pw; if (edge >= 1) edge -= 1;
              o = (ph < pw ? 1 : -1) + polyblep(ph, dtp) - polyblep(edge, dtp);
              tL[s] += o * pl; tR[s] += o * pr;
              ph += dtp; if (ph >= 1) ph -= 1;
            }
          }
          this.phase[pi2] = ph;
        }
      } else if (q.type === 1) {                /* ---- 波表 ---- */
        var tab = q.tab, mo = q.morph, m0 = 1 - mo;
        for (u = 0; u < nUni; u++) {
          var pi3 = g * 5 + u, ph3 = this.phase[pi3], dtp3 = step[pi3];
          var mip = mipLevel(dtp3 * sr, sr);
          var A = tab.a[mip], B = tab.b[mip];
          var pl3 = pL[pi3], pr3 = pR[pi3], o3 = 0;
          for (s = 0; s < len; s++) {
            var pos = ph3 * TSIZE, i0 = pos | 0, fr = pos - i0, i1 = (i0 + 1) & MASK;
            var a0 = A[i0] * m0 + B[i0] * mo, a1 = A[i1] * m0 + B[i1] * mo;
            o3 = a0 + (a1 - a0) * fr;
            tL[s] += o3 * pl3; tR[s] += o3 * pr3;
            ph3 += dtp3; if (ph3 >= 1) ph3 -= 1;
          }
          this.phase[pi3] = ph3;
        }
      } else if (q.type === 2) {                /* ---- FM 算子 ---- */
        var mp = this.mphase[g], fb = q.fb * 0.6, ind = q.idx, ratio = q.ratio;
        var fbNow = this.fbprev[g];
        for (u = 0; u < nUni; u++) {
          var pi4 = g * 5 + u, ph4 = this.phase[pi4], dtp4 = step[pi4];
          var pl4 = pL[pi4], pr4 = pR[pi4], o4 = 0;
          for (s = 0; s < len; s++) {
            var modSig = Math.sin(mp * TAU + fbNow * fb);
            fbNow = modSig;
            o4 = Math.sin(ph4 * TAU + ind * modSig);
            tL[s] += o4 * pl4; tR[s] += o4 * pr4;
            ph4 += dtp4; if (ph4 >= 1) ph4 -= 1;
            mp += dtp4 * ratio; if (mp >= 1) mp -= Math.floor(mp);
          }
          this.phase[pi4] = ph4;
        }
        this.mphase[g] = mp; this.fbprev[g] = fbNow;
      } else {                                  /* ---- 噪声 ---- */
        var col = q.color, pk = this.pinkLp[g];
        for (u = 0; u < nUni; u++) {
          var pi5 = g * 5 + u, ph5 = this.phase[pi5], dtp5 = step[pi5];
          var pl5 = pL[pi5], pr5 = pR[pi5], o5 = 0;
          for (s = 0; s < len; s++) {
            var nz = Math.random() * 2 - 1;
            pk += (nz - pk) * 0.08;
            o5 = nz * col + pk * (1 - col) * 2.2;
            tL[s] += o5 * pl5; tR[s] += o5 * pr5;
            ph5 += dtp5; if (ph5 >= 1) ph5 -= 1;
          }
          this.phase[pi5] = ph5;
        }
        this.pinkLp[g] = pk;
      }

      /* 每发生器滤波：保留立体声，只把中置成分过一遍滤波器 */
      if (q.ftype) {
        for (s = 0; s < len; s++) {
          var m = (tL[s] + tR[s]) * 0.5;
          var f = filt.process(m);
          tL[s] += f - m; tR[s] += f - m;
        }
      }

      var lvA = q.lvlA, lvB = q.lvlB, inv = 1 / len;
      for (s = 0; s < len; s++) {
        var lv = lvA + (lvB - lvA) * (s * inv);
        bufL[s] += tL[s] * lv;
        bufR[s] += tR[s] * lv;
      }
    }

    if (c.flt.on) {
      this.gfilt.mode = c.flt.type;
      this.gfilt.set(eng.val(this, 'flt.cut'), clamp(eng.val(this, 'flt.res'), 0, 0.99), sr);
      var dr = eng.val(this, 'flt.drive'), dk = 1 + dr * 6, dnorm = dr > 0 ? Math.tanh(dk) : 1;
      for (s = 0; s < len; s++) {
        var m2 = (bufL[s] + bufR[s]) * 0.5;
        var f2 = this.gfilt.process(m2);
        if (dr > 0) f2 = Math.tanh(f2 * dk) / dnorm;
        bufL[s] += f2 - m2; bufR[s] += f2 - m2;
      }
    }

    var vg = 0.18 + 0.82 * Math.pow(this.vel, 1.3);
    for (s = 0; s < len; s++) {
      L[off + s] += bufL[s] * vg;
      R[off + s] += bufR[s] * vg;
    }

    if (this.envs[0].stage === 0 && this.envs[1].stage === 0 && this.envs[2].stage === 0) this.active = false;
  };

  function mipLevel(f, sr) {
    var h = (sr * 0.5) / (f > 20 ? f : 20);
    return h >= 64 ? 0 : h >= 32 ? 1 : h >= 16 ? 2 : h >= 8 ? 3 : h >= 4 ? 4 : 5;
  }

  /* --------------------------------------------------------------- 效果处理 */
  function processFx(fx, L, R, off, len, sr) {
    if (!fx.on) return;
    var p1 = fx.p1, p2 = fx.p2, p3 = fx.p3, mix = fx.mix, st = fx.st, i;
    var t = fx.type;
    if (t === 0) { // 驱动
      var pre = 1 + p1 * 24;
      var tone = 0.02 + p2 * 0.9;
      for (i = 0; i < len; i++) {
        var l = L[off + i] * pre, r = R[off + i] * pre;
        l = Math.tanh(l) / Math.tanh(pre > 1 ? pre : 1);
        r = Math.tanh(r) / Math.tanh(pre > 1 ? pre : 1);
        st.lpL += (l - st.lpL) * tone;
        st.lpR += (r - st.lpR) * tone;
        L[off + i] = L[off + i] * (1 - mix) + st.lpL * mix;
        R[off + i] = R[off + i] * (1 - mix) + st.lpR * mix;
      }
    } else if (t === 1) { // 降位
      var bits = 16 - p1 * 14, step = Math.pow(2, bits) / 2;
      var ds = 1 + Math.round(p2 * 60);
      if (st.cnt === undefined) { st.cnt = 0; st.hl = 0; st.hr = 0; }
      for (i = 0; i < len; i++) {
        if (st.cnt % ds === 0) {
          st.hl = Math.round(L[off + i] * step) / step;
          st.hr = Math.round(R[off + i] * step) / step;
        }
        st.cnt++;
        L[off + i] = L[off + i] * (1 - mix) + st.hl * mix;
        R[off + i] = R[off + i] * (1 - mix) + st.hr * mix;
      }
    } else if (t === 2) { // 合唱
      var bufL = st.bufL, bufR = st.bufR, len2 = bufL.length, w = st.w;
      var rate = 0.05 + p1 * 3, depth = 0.002 + p2 * 0.008;
      var ph = st.ph;
      for (i = 0; i < len; i++) {
        ph += rate / sr; if (ph >= 1) ph -= 1;
        var d1 = (0.012 + Math.sin(ph * TAU) * depth) * sr;
        var d2 = (0.019 + Math.sin((ph * 1.31 + 0.25) * TAU) * depth) * sr;
        var r1 = w - d1 | 0, r2 = w - d2 | 0;
        if (r1 < 0) r1 += len2; if (r2 < 0) r2 += len2;
        var wl = bufL[r1] || 0, wr = bufR[r2] || 0;
        bufL[w] = L[off + i] + wl * p3 * 0.5;
        bufR[w] = R[off + i] + wr * p3 * 0.5;
        w = (w + 1) % len2;
        L[off + i] = L[off + i] * (1 - mix) + wl * mix;
        R[off + i] = R[off + i] * (1 - mix) + wr * mix;
      }
      st.w = w; st.ph = ph;
    } else if (t === 3) { // 移相
      var apL = st.apL, apR = st.apR;
      var fq = 0.1 + p1 * 2.4;
      var ph2 = st.ph;
      var fb2 = p3 * 0.9;
      for (i = 0; i < len; i++) {
        ph2 += fq / sr; if (ph2 >= 1) ph2 -= 1;
        var fcoef = 0.2 + 0.75 * (0.5 + 0.5 * Math.sin(ph2 * TAU));
        var inl = L[off + i] + (st.lastL || 0) * fb2;
        var inr = R[off + i] + (st.lastR || 0) * fb2;
        for (var s3 = 0; s3 < 6; s3++) {
          var yl = fcoef * inl + apL[s3];
          apL[s3] = inl - fcoef * yl; inl = yl;
          var yr = fcoef * inr + apR[s3];
          apR[s3] = inr - fcoef * yr; inr = yr;
        }
        st.lastL = inl; st.lastR = inr;
        L[off + i] = L[off + i] * (1 - mix) + inl * mix;
        R[off + i] = R[off + i] * (1 - mix) + inr * mix;
      }
      st.ph = ph2;
    } else if (t === 4) { // 延迟
      var bL = st.bufL, bR = st.bufR, ln = bL.length, w2 = st.w;
      var dtime = (0.04 + p1 * 0.9) * sr;
      var fb3 = p2 * 0.92;
      var tone2 = 0.05 + p3 * 0.7;
      for (i = 0; i < len; i++) {
        var rd = w2 - dtime;
        if (rd < 0) rd += ln;
        var rdi = rd | 0;
        var dl = bL[rdi], dr = bR[rdi];
        st.lpL += (dl - st.lpL) * tone2;
        st.lpR += (dr - st.lpR) * tone2;
        bL[w2] = L[off + i] + st.lpR * fb3;
        bR[w2] = R[off + i] + st.lpL * fb3;
        w2 = (w2 + 1) % ln;
        L[off + i] = L[off + i] * (1 - mix) + st.lpL * mix;
        R[off + i] = R[off + i] * (1 - mix) + st.lpR * mix;
      }
      st.w = w2;
    } else if (t === 5) { // 混响（Freeverb 简化）
      var room = 0.72 + p1 * 0.2, damp = p2 * 0.7, wet = mix;
      var cL = st.combL, cR = st.combR, aL2 = st.apL, aR2 = st.apR;
      for (i = 0; i < len; i++) {
        var inL = L[off + i] * 0.22, inR = R[off + i] * 0.22;
        var sumL = 0, sumR = 0;
        for (var ci = 0; ci < 8; ci++) {
          var cb = cL[ci]; var y = cb.b[cb.w];
          cb.lp = y * (1 - damp) + cb.lp * damp;
          cb.b[cb.w] = inL + cb.lp * room;
          cb.w = (cb.w + 1) % cb.b.length; sumL += y;
          var cb2 = cR[ci]; var y2 = cb2.b[cb2.w];
          cb2.lp = y2 * (1 - damp) + cb2.lp * damp;
          cb2.b[cb2.w] = inR + cb2.lp * room;
          cb2.w = (cb2.w + 1) % cb2.b.length; sumR += y2;
        }
        sumL *= 0.125; sumR *= 0.125;
        for (var ai = 0; ai < 4; ai++) {
          var ab = aL2[ai], bp = ab.b[ab.w];
          ab.b[ab.w] = sumL + bp * 0.5;
          ab.w = (ab.w + 1) % ab.b.length;
          sumL = bp - sumL;
          var ab2 = aR2[ai], bp2 = ab2.b[ab2.w];
          ab2.b[ab2.w] = sumR + bp2 * 0.5;
          ab2.w = (ab2.w + 1) % ab2.b.length;
          sumR = bp2 - sumR;
        }
        L[off + i] = L[off + i] * (1 - wet) + sumL * wet;
        R[off + i] = R[off + i] * (1 - wet) + sumR * wet;
      }
    } else if (t === 6) { // 均衡（倾斜 + 低频）
      var tilt = (p1 - 0.5) * 2, lowg = (p2 - 0.5) * 2, higg = (p3 - 0.5) * 2;
      var al = 1 - Math.exp(-TAU * 250 / sr), ah = 1 - Math.exp(-TAU * 3500 / sr);
      for (i = 0; i < len; i++) {
        var xl = L[off + i], xr = R[off + i];
        st.lL += (xl - st.lL) * al; st.lR += (xr - st.lR) * al;
        st.xl += (xl - st.xl) * ah; st.xr += (xr - st.xr) * ah;
        var lowpL = st.lL, lowpR = st.lR, highL = xl - st.xl, highR = xr - st.xr, midL = st.xl - st.lL, midR = st.xr - st.lR;
        var oL = midL * (1 + tilt * 0.5) + lowpL * (1 + lowg + tilt * 0.5) + highL * (1 + higg - tilt * 0.5);
        var oR = midR * (1 + tilt * 0.5) + lowpR * (1 + lowg + tilt * 0.5) + highR * (1 + higg - tilt * 0.5);
        L[off + i] = xl * (1 - mix) + oL * mix;
        R[off + i] = xr * (1 - mix) + oR * mix;
      }
    } else if (t === 7) { // 压缩
      var thr = 0.05 + p1 * 0.8, ratio = 1 + p2 * 12;
      var att = Math.exp(-1 / (0.002 * sr));
      var rel = Math.exp(-1 / ((0.06 + p3 * 0.5) * sr));
      for (i = 0; i < len; i++) {
        var pk = Math.max(Math.abs(L[off + i]), Math.abs(R[off + i]));
        st.env = pk > st.env ? st.env * att + pk * (1 - att) : st.env * rel + pk * (1 - rel);
        var over = st.env / thr;
        var gain = over > 1 ? Math.pow(over, 1 / ratio - 1) : 1;
        L[off + i] *= 1 + (gain - 1) * mix;
        R[off + i] *= 1 + (gain - 1) * mix;
      }
    } else if (t === 8) { // 全局滤波
      var cut = 80 * Math.pow(220, p1), res = p2 * 0.95;
      st.fl.mode = 1; st.fr.mode = 1;
      st.fl.set(cut, res, sr); st.fr.set(cut, res, sr);
      for (i = 0; i < len; i++) {
        var fl = st.fl.process(L[off + i]), fr = st.fr.process(R[off + i]);
        L[off + i] = L[off + i] * (1 - mix) + fl * mix;
        R[off + i] = R[off + i] * (1 - mix) + fr * mix;
      }
    } else if (t === 9) { // 立体声宽度
      var w3 = p1 * 1.6, mg = 1 + (p2 - 0.5) * 0.8;
      for (i = 0; i < len; i++) {
        var ml = (L[off + i] + R[off + i]) * 0.5, sl = (L[off + i] - R[off + i]) * 0.5;
        ml *= mg;
        var nl = ml + sl * w3, nr = ml - sl * w3;
        L[off + i] = L[off + i] * (1 - mix) + nl * mix;
        R[off + i] = R[off + i] * (1 - mix) + nr * mix;
      }
    }
  }

  /* ----------------------------------------------------------------- 主渲染 */
  Engine.prototype.process = function (L, R, frames) {
    if (!this.c) return;
    var i;
    for (i = 0; i < frames; i++) { L[i] = 0; R[i] = 0; }
    for (var off = 0; off < frames; off += CHUNK) {
      var len = Math.min(CHUNK, frames - off);
      var c = this.c;
      var active = 0;
      var latest = null;
      for (i = 0; i < 16; i++) {
        var v = this.voices[i];
        if (v.active) {
          v.render(this, L, R, off, len);
          if (v.active) active++;
          if (!latest || v.age > latest.age) latest = v;
        }
      }
      if (!latest) latest = this.ghost;
      if (!latest.active) {
        var gdt = len / this.sr;
        latest.updateMods(this, gdt);
        latest.mod.fill(0);
      }
      // 全局调制镜像
      var mods = c.mods, g = this.gmod;
      g.fill(0);
      for (i = 0; i < mods.length; i++) {
        var mm = mods[i];
        g[mm.slot] += mm.amt * latest.src[mm.si];
      }
      // 效果参数（含调制）
      for (i = 0; i < 5; i++) {
        var fx = this.fxs[i];
        fx.p1 = clamp(fromNorm(P['fx' + i + '.p1'], c.base[P['fx' + i + '.p1'].slot] + g[P['fx' + i + '.p1'].slot]), 0, 1);
        fx.p2 = clamp(fromNorm(P['fx' + i + '.p2'], c.base[P['fx' + i + '.p2'].slot] + g[P['fx' + i + '.p2'].slot]), 0, 1);
        fx.p3 = clamp(fromNorm(P['fx' + i + '.p3'], c.base[P['fx' + i + '.p3'].slot] + g[P['fx' + i + '.p3'].slot]), 0, 1);
        fx.mix = clamp(fromNorm(P['fx' + i + '.mix'], c.base[P['fx' + i + '.mix'].slot] + g[P['fx' + i + '.mix'].slot]), 0, 1);
      }
      this.meterVoices = active;
      for (i = 0; i < 5; i++) processFx(this.fxs[i], L, R, off, len, this.sr);

      // 主输出（含换音色/静音时的淡入淡出）
      this.gainS += (c.gain - this.gainS) * 0.25;
      var gain = this.gainS;
      var mg0 = this.muteGain;
      var mg1 = mg0 + (this.muteTarget - mg0) * (1 - Math.exp(-len / (0.004 * this.sr)));
      this.muteGain = mg1;
      for (i = 0; i < len; i++) {
        var mg = mg0 + (mg1 - mg0) * (i / len);
        var l = L[off + i] * gain * mg, r = R[off + i] * gain * mg;
        l = Math.tanh(l * 1.1) * 0.97;
        r = Math.tanh(r * 1.1) * 0.97;
        // DC 阻断（一阶高通）
        this.dcYl = l - this.dcXl + 0.9985 * this.dcYl; this.dcXl = l; l = this.dcYl;
        this.dcYr = r - this.dcXr + 0.9985 * this.dcYr; this.dcXr = r; r = this.dcYr;
        // 硬限幅兜底
        L[off + i] = l > 0.985 ? 0.985 : l < -0.985 ? -0.985 : l;
        R[off + i] = r > 0.985 ? 0.985 : r < -0.985 ? -0.985 : r;
      }
      // 淡出到位后：应用待切换的音色 / 清掉效果器尾音
      if (this._pendingPatch && this.muteGain < 0.01) {
        var pp = this._pendingPatch;
        this._pendingPatch = null;
        this.applyPatch(pp);
        this.muteTarget = 1;
      }
      if (this._panicPending && this.muteGain < 0.01) {
        this._panicPending = false;
        this.fxs = [];
        this.compile();
        this.muteGain = 1;
        this.muteTarget = 1;
      }
      var sum = 0;
      for (i = 0; i < len; i++) sum += L[off + i] * L[off + i] + R[off + i] * R[off + i];
      this.meter = this.meter * 0.8 + Math.sqrt(sum / (len * 2)) * 0.2;
      this.activeVoices = active;
    }
  };

  /* 离线渲染（测试用）：返回 [L,R] */
  Engine.prototype.renderOffline = function (seconds, notes) {
    var n = Math.floor(seconds * this.sr);
    var L = new Float32Array(n), R = new Float32Array(n);
    var block = 128;
    var time = 0;
    var pending = (notes || []).slice().sort(function (a, b) { return a.t - b.t; });
    var pi = 0;
    for (var off = 0; off < n; off += block) {
      var len = Math.min(block, n - off);
      while (pi < pending.length && pending[pi].t * this.sr <= off) {
        var ev = pending[pi++];
        if (ev.on) this.noteOn(ev.midi, ev.vel === undefined ? 1 : ev.vel);
        else this.noteOff(ev.midi);
      }
      this.process(L.subarray(off, off + len), R.subarray(off, off + len), len);
    }
    return [L, R];
  };

  /* ------------------------------------------------------------------ 导出 */
  var PLANT = {
    Engine: Engine,
    PARAMS: P,
    NSLOT: NSLOT,
    MOD_SOURCES: MOD_SOURCES,
    MOD_LABELS: MOD_LABELS,
    SOURCE_COLORS: SOURCE_COLORS,
    GEN_TYPES: GEN_TYPES, GEN_TYPES_EN: GEN_TYPES_EN,
    WAVES: WAVES, WAVES_EN: WAVES_EN,
    FTYPES: FTYPES, FTYPES_EN: FTYPES_EN,
    FX_TYPES: FX_TYPES, FX_EN: FX_EN,
    LFO_SHAPES: LFO_SHAPES, LFO_DIVS: LFO_DIVS,
    TABLE_NAMES: ['锯齿/方波', '正弦/三角', '管风琴', '人声', '金属', '数字'],
    toNorm: toNorm,
    fromNorm: fromNorm,
    defaults: function () {
      var o = {};
      for (var id in P) o[id] = P[id].def;
      return o;
    },
    version: '1.0.0'
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PLANT;
  root.PLANT = PLANT;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
