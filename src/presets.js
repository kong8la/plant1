/* ============================================================================
 * PLANT-1 预设音色库
 * 每个预设 = 参数覆盖表 + 调制连线。缺省参数由引擎的 PARAMS 默认值补齐。
 * ==========================================================================*/
(function (root) {
  'use strict';

  function m(src, target, amt) { return { src: src, target: target, amt: amt }; }

  var PRESETS = [
    {
      name: '初始化', en: 'INIT', tags: ['基础'],
      params: {
        'gen0.type': 0, 'gen0.wave': 0, 'gen0.level': 0, 'gen0.cut': 6000, 'gen0.res': 0.1,
        'gen1.on': 0, 'gen2.on': 0, 'gen3.on': 0,
        'flt.on': 0,
        'env0.a': 0.005, 'env0.d': 0.9, 'env0.s': 0.7, 'env0.r': 0.4
      },
      mods: [m('env1', 'gen0.level', 0.8)]
    },
    {
      name: 'DX 玻璃钟', en: 'GLASS BELL', tags: ['FM', '钟'],
      params: {
        'gen0.type': 2, 'gen0.level': 0, 'gen0.ratio': 3.5, 'gen0.index': 0, 'gen0.fb': 0.08,
        'gen1.type': 2, 'gen1.on': 1, 'gen1.level': 0, 'gen1.ratio': 7.01, 'gen1.index': 0,
        'gen1.tune': 12, 'gen1.pan': 0.35,
        'env0.a': 0.002, 'env0.d': 2.2, 'env0.s': 0, 'env0.r': 2.4,
        'env1.a': 0.001, 'env1.d': 0.55, 'env1.s': 0, 'env1.r': 0.5,
        'env2.a': 0.4, 'env2.d': 1.6, 'env2.s': 0.25, 'env2.r': 1.2,
        'fx2.on': 1, 'fx2.type': 4, 'fx2.p1': 0.34, 'fx2.p2': 0.35, 'fx2.p3': 0.5, 'fx2.mix': 0.22,
        'fx3.on': 1, 'fx3.type': 5, 'fx3.p1': 0.62, 'fx3.p2': 0.42, 'fx3.mix': 0.3
      },
      mods: [
        m('env1', 'gen0.level', 0.9), m('env1', 'gen1.level', 0.8),
        m('env2', 'gen0.index', 0.55), m('env2', 'gen1.index', 0.45),
        m('env3', 'gen0.pan', 0.1)
      ]
    },
    {
      name: 'FM 低音', en: 'FM BASS', tags: ['FM', '低音'],
      params: {
        'voice.poly': 4, 'voice.gain': 0.85,
        'gen0.type': 2, 'gen0.level': 0, 'gen0.ratio': 1, 'gen0.index': 1.6, 'gen0.fb': 0.3,
        'gen0.tune': -12,
        'gen1.type': 2, 'gen1.on': 1, 'gen1.level': 0, 'gen1.ratio': 2.01, 'gen1.index': 0.6,
        'gen1.tune': -12,
        'flt.on': 1, 'flt.type': 1, 'flt.cut': 420, 'flt.res': 0.32, 'flt.drive': 0.25,
        'env0.a': 0.002, 'env0.d': 0.5, 'env0.s': 0.45, 'env0.r': 0.16,
        'env1.a': 0.001, 'env1.d': 0.16, 'env1.s': 0, 'env1.r': 0.12,
        'env2.a': 0.001, 'env2.d': 0.28, 'env2.s': 0, 'env2.r': 0.2,
        'fx0.on': 1, 'fx0.type': 0, 'fx0.p1': 0.35, 'fx0.p2': 0.55, 'fx0.mix': 0.35,
        'fx1.on': 1, 'fx1.type': 7, 'fx1.p1': 0.5, 'fx1.p2': 0.45, 'fx1.p3': 0.3, 'fx1.mix': 0.6
      },
      mods: [
        m('env1', 'gen0.level', 0.85), m('env1', 'gen1.level', 0.5),
        m('env2', 'flt.cut', 0.28), m('env2', 'gen1.index', 0.3), m('env1', 'gen0.index', 0.1)
      ]
    },
    {
      name: '超锯齿', en: 'SUPER SAW', tags: ['模拟', '铺底', '齐奏'],
      params: {
        'voice.unison': 5, 'voice.detune': 28, 'voice.spread': 0.9,
        'gen0.type': 0, 'gen0.wave': 0, 'gen0.level': 0, 'gen0.cut': 9000, 'gen0.ftype': 1, 'gen0.res': 0.08,
        'gen1.type': 0, 'gen1.wave': 0, 'gen1.on': 1, 'gen1.level': 0, 'gen1.tune': -12, 'gen1.cut': 5000,
        'gen1.ftype': 1, 'gen1.res': 0.1, 'gen1.pan': -0.15,
        'flt.on': 1, 'flt.type': 1, 'flt.cut': 7000, 'flt.res': 0.12,
        'env0.a': 0.02, 'env0.d': 1.2, 'env0.s': 0.8, 'env0.r': 0.5,
        'env1.a': 0.25, 'env1.d': 1.2, 'env1.s': 0.55, 'env1.r': 0.6,
        'env2.a': 0.05, 'env2.d': 1.8, 'env2.s': 0.4, 'env2.r': 0.9,
        'lfo0.rate': 0.18, 'lfo0.shape': 0,
        'fx1.on': 1, 'fx1.type': 2, 'fx1.p1': 0.22, 'fx1.p2': 0.45, 'fx1.p3': 0.3, 'fx1.mix': 0.4,
        'fx3.on': 1, 'fx3.type': 5, 'fx3.p1': 0.6, 'fx3.p2': 0.5, 'fx3.mix': 0.28
      },
      mods: [
        m('env1', 'gen0.level', 0.75), m('env1', 'gen1.level', 0.55),
        m('lfo1', 'flt.cut', 0.18), m('env2', 'gen1.pan', 0.25), m('lfo1', 'gen0.pan', 0.12)
      ]
    },
    {
      name: '相位铺底', en: 'PHASE PAD', tags: ['波表', '铺底'],
      params: {
        'voice.unison': 3, 'voice.detune': 12, 'voice.spread': 0.8, 'voice.poly': 8, 'voice.gain': 0.7,
        'gen0.type': 1, 'gen0.table': 0, 'gen0.morph': 0.35, 'gen0.level': 0,
        'gen0.cut': 3200, 'gen0.ftype': 1, 'gen0.res': 0.22,
        'gen1.type': 1, 'gen1.table': 3, 'gen1.on': 1, 'gen1.level': 0, 'gen1.morph': 0.6,
        'gen1.tune': 12, 'gen1.pan': 0.3, 'gen1.cut': 4000, 'gen1.ftype': 1, 'gen1.res': 0.15,
        'flt.on': 1, 'flt.type': 1, 'flt.cut': 4200, 'flt.res': 0.18,
        'env0.a': 0.9, 'env0.d': 2.5, 'env0.s': 0.85, 'env0.r': 2.2, 'env0.curve': -0.2,
        'env1.a': 2.2, 'env1.d': 3, 'env1.s': 0.9, 'env1.r': 3,
        'lfo0.rate': 0.09, 'lfo0.shape': 0, 'lfo1.rate': 0.13, 'lfo1.shape': 0,
        'fx1.on': 1, 'fx1.type': 2, 'fx1.p1': 0.12, 'fx1.p2': 0.7, 'fx1.p3': 0.25, 'fx1.mix': 0.45,
        'fx3.on': 1, 'fx3.type': 5, 'fx3.p1': 0.85, 'fx3.p2': 0.55, 'fx3.mix': 0.45
      },
      mods: [
        m('env1', 'gen0.level', 0.42), m('env1', 'gen1.level', 0.26),
        m('lfo1', 'gen0.morph', 0.35), m('lfo2', 'flt.cut', 0.22), m('lfo2', 'gen1.morph', 0.2)
      ]
    },
    {
      name: '混沌铅音', en: 'CHAOS LEAD', tags: ['模拟', '铅音'],
      params: {
        'voice.unison': 2, 'voice.detune': 16, 'voice.poly': 1, 'voice.glide': 60,
        'gen0.type': 0, 'gen0.wave': 2, 'gen0.pwm': 0.4, 'gen0.level': 0,
        'gen0.cut': 5200, 'gen0.ftype': 1, 'gen0.res': 0.38,
        'gen1.type': 0, 'gen1.wave': 0, 'gen1.on': 1, 'gen1.level': 0, 'gen1.tune': 12, 'gen1.pan': 0.2,
        'env0.a': 0.004, 'env0.d': 0.5, 'env0.s': 0.75, 'env0.r': 0.25,
        'env1.a': 0.01, 'env1.d': 0.4, 'env1.s': 0.6, 'env1.r': 0.4,
        'lfo0.rate': 5.2, 'lfo0.shape': 0, 'lfo0.amp': 0.5,
        'chaos.rate': 1.6, 'chaos.smooth': 0.35,
        'fx0.on': 1, 'fx0.type': 0, 'fx0.p1': 0.3, 'fx0.p2': 0.5, 'fx0.mix': 0.4,
        'fx2.on': 1, 'fx2.type': 4, 'fx2.p1': 0.3, 'fx2.p2': 0.45, 'fx2.p3': 0.45, 'fx2.mix': 0.28
      },
      mods: [
        m('env1', 'gen0.level', 0.8), m('env1', 'gen1.level', 0.5),
        m('chaos', 'gen0.pwm', 0.2), m('chaos', 'flt.cut', 0.15),
        m('lfo1', 'gen0.pan', 0.2), m('lfo1', 'gen1.tune', 0.04)
      ]
    },
    {
      name: '塑料拨弦', en: 'PLASTIC PLUCK', tags: ['波表', '拨弦'],
      params: {
        'voice.poly': 8,
        'gen0.type': 1, 'gen0.table': 2, 'gen0.morph': 0.25, 'gen0.level': 0,
        'gen0.cut': 2800, 'gen0.ftype': 1, 'gen0.res': 0.3,
        'gen1.type': 3, 'gen1.on': 1, 'gen1.level': 0, 'gen1.color': 0.3, 'gen1.pan': 0.2,
        'env0.a': 0.001, 'env0.d': 0.42, 'env0.s': 0, 'env0.r': 0.3,
        'env1.a': 0.001, 'env1.d': 0.22, 'env1.s': 0, 'env1.r': 0.2,
        'env2.a': 0.001, 'env2.d': 0.06, 'env2.s': 0, 'env2.r': 0.06,
        'fx2.on': 1, 'fx2.type': 4, 'fx2.p1': 0.28, 'fx2.p2': 0.25, 'fx2.p3': 0.4, 'fx2.mix': 0.18,
        'fx3.on': 1, 'fx3.type': 5, 'fx3.p1': 0.45, 'fx3.p2': 0.5, 'fx3.mix': 0.2
      },
      mods: [
        m('env1', 'gen0.level', 0.9), m('env2', 'gen1.level', 0.5),
        m('env2', 'gen0.cut', 0.4), m('env2', 'gen0.morph', 0.25)
      ]
    },
    {
      name: '金属打击', en: 'METAL HIT', tags: ['FM', '打击乐'],
      params: {
        'voice.poly': 6,
        'gen0.type': 2, 'gen0.ratio': 7.31, 'gen0.index': 9, 'gen0.fb': 0.2, 'gen0.level': 0,
        'gen0.tune': 12, 'gen0.pan': -0.2,
        'gen1.type': 2, 'gen1.on': 1, 'gen1.ratio': 11.7, 'gen1.index': 5, 'gen1.level': 0,
        'gen1.tune': 19, 'gen1.pan': 0.25,
        'flt.on': 1, 'flt.type': 3, 'flt.cut': 2600, 'flt.res': 0.3,
        'env0.a': 0.001, 'env0.d': 0.9, 'env0.s': 0, 'env0.r': 0.8,
        'env1.a': 0.001, 'env1.d': 0.25, 'env1.s': 0, 'env1.r': 0.2,
        'fx0.on': 1, 'fx0.type': 1, 'fx0.p1': 0.5, 'fx0.p2': 0.35, 'fx0.mix': 0.35,
        'fx3.on': 1, 'fx3.type': 5, 'fx3.p1': 0.5, 'fx3.p2': 0.4, 'fx3.mix': 0.4
      },
      mods: [
        m('env1', 'gen0.level', 0.9), m('env1', 'gen1.level', 0.7),
        m('env2', 'gen0.index', 0.4), m('env2', 'flt.cut', 0.3)
      ]
    },
    {
      name: '黑暗合唱', en: 'DARK CHOIR', tags: ['波表', '铺底'],
      params: {
        'voice.poly': 8, 'voice.unison': 2, 'voice.detune': 9, 'voice.spread': 0.7,
        'gen0.type': 1, 'gen0.table': 3, 'gen0.morph': 0.25, 'gen0.level': 0,
        'gen0.cut': 1500, 'gen0.ftype': 1, 'gen0.res': 0.25, 'gen0.tune': -12,
        'gen1.type': 1, 'gen1.table': 3, 'gen1.morph': 0.55, 'gen1.on': 1, 'gen1.level': 0,
        'gen1.cut': 1900, 'gen1.ftype': 1, 'gen1.res': 0.2, 'gen1.pan': 0.35,
        'flt.on': 1, 'flt.type': 1, 'flt.cut': 2300, 'flt.res': 0.2,
        'env0.a': 0.6, 'env0.d': 2, 'env0.s': 0.8, 'env0.r': 1.8,
        'env1.a': 1.4, 'env1.d': 2, 'env1.s': 0.85, 'env1.r': 2.4,
        'lfo0.rate': 0.16, 'lfo0.shape': 0, 'lfo1.rate': 0.21, 'lfo1.shape': 1,
        'fx1.on': 1, 'fx1.type': 2, 'fx1.p1': 0.1, 'fx1.p2': 0.75, 'fx1.p3': 0.2, 'fx1.mix': 0.5,
        'fx3.on': 1, 'fx3.type': 5, 'fx3.p1': 0.9, 'fx3.p2': 0.62, 'fx3.mix': 0.5
      },
      mods: [
        m('env1', 'gen0.level', 0.65), m('env1', 'gen1.level', 0.5),
        m('lfo1', 'gen0.morph', 0.2), m('lfo2', 'gen1.morph', 0.25), m('lfo2', 'flt.cut', 0.12)
      ]
    },
    {
      name: '酸性 303', en: 'ACID 303', tags: ['模拟', '贝斯'],
      params: {
        'voice.poly': 1, 'voice.glide': 80, 'voice.unison': 1,
        'gen0.type': 0, 'gen0.wave': 0, 'gen0.level': 0, 'gen0.tune': -12,
        'flt.on': 1, 'flt.type': 1, 'flt.cut': 300, 'flt.res': 0.78, 'flt.drive': 0.3,
        'env0.a': 0.002, 'env0.d': 0.3, 'env0.s': 0.2, 'env0.r': 0.12,
        'env1.a': 0.001, 'env1.d': 0.19, 'env1.s': 0, 'env1.r': 0.14,
        'env2.a': 0.001, 'env2.d': 0.35, 'env2.s': 0.1, 'env2.r': 0.2,
        'fx0.on': 1, 'fx0.type': 0, 'fx0.p1': 0.4, 'fx0.p2': 0.6, 'fx0.mix': 0.45,
        'fx1.on': 1, 'fx1.type': 4, 'fx1.p1': 0.24, 'fx1.p2': 0.3, 'fx1.p3': 0.35, 'fx1.mix': 0.15
      },
      mods: [
        m('env1', 'gen0.level', 0.95), m('env2', 'flt.cut', 0.42), m('env1', 'flt.cut', 0.12)
      ]
    },
    {
      name: '噪声上升', en: 'NOISE RISER', tags: ['噪声', '效果'],
      params: {
        'voice.poly': 1, 'voice.unison': 3, 'voice.detune': 20, 'voice.spread': 1,
        'gen0.type': 3, 'gen0.color': 0.55, 'gen0.level': 0, 'gen0.cut': 900,
        'gen0.ftype': 1, 'gen0.res': 0.45,
        'env0.a': 3.5, 'env0.d': 1, 'env0.s': 1, 'env0.r': 0.6,
        'env1.a': 3.2, 'env1.d': 0.6, 'env1.s': 0.1, 'env1.r': 0.5,
        'lfo0.rate': 0.6, 'lfo0.shape': 0, 'lfo0.amp': 0.4,
        'fx3.on': 1, 'fx3.type': 5, 'fx3.p1': 0.8, 'fx3.p2': 0.5, 'fx3.mix': 0.4
      },
      mods: [
        m('env1', 'gen0.level', 0.85), m('env2', 'gen0.cut', 0.65),
        m('lfo1', 'gen0.pan', 0.35), m('chaos', 'gen0.color', 0.25)
      ]
    },
    {
      name: '80s 铜管', en: 'BRASS 80S', tags: ['模拟', '键盘'],
      params: {
        'voice.poly': 8, 'voice.unison': 2, 'voice.detune': 8, 'voice.spread': 0.5,
        'gen0.type': 0, 'gen0.wave': 0, 'gen0.level': 0, 'gen0.cut': 2200, 'gen0.ftype': 1, 'gen0.res': 0.2,
        'gen1.type': 0, 'gen1.wave': 2, 'gen1.pwm': 0.35, 'gen1.on': 1, 'gen1.level': 0,
        'gen1.tune': -12, 'gen1.pan': -0.1, 'gen1.cut': 1800, 'gen1.ftype': 1, 'gen1.res': 0.15,
        'env0.a': 0.05, 'env0.d': 0.8, 'env0.s': 0.75, 'env0.r': 0.4,
        'env1.a': 0.12, 'env1.d': 0.6, 'env1.s': 0.6, 'env1.r': 0.5,
        'env2.a': 0.06, 'env2.d': 0.5, 'env2.s': 0.2, 'env2.r': 0.3,
        'lfo0.rate': 5.6, 'lfo0.shape': 0, 'lfo0.amp': 0.35,
        'fx1.on': 1, 'fx1.type': 2, 'fx1.p1': 0.15, 'fx1.p2': 0.5, 'fx1.p3': 0.2, 'fx1.mix': 0.3,
        'fx3.on': 1, 'fx3.type': 5, 'fx3.p1': 0.5, 'fx3.p2': 0.5, 'fx3.mix': 0.2
      },
      mods: [
        m('env1', 'gen0.level', 0.75), m('env1', 'gen1.level', 0.6),
        m('env2', 'flt.cut', 0.3), m('env2', 'gen0.cut', 0.25), m('lfo1', 'gen0.tune', 0.006)
      ]
    },
    {
      name: '数字雨', en: 'DIGITAL RAIN', tags: ['波表', 'FM', '效果'],
      params: {
        'voice.poly': 8, 'voice.unison': 2, 'voice.detune': 18, 'voice.spread': 0.8,
        'gen0.type': 1, 'gen0.table': 5, 'gen0.morph': 0.5, 'gen0.level': 0,
        'gen0.cut': 5200, 'gen0.ftype': 1, 'gen0.res': 0.3,
        'gen1.type': 2, 'gen1.on': 1, 'gen1.ratio': 2.01, 'gen1.index': 2, 'gen1.level': 0,
        'gen1.tune': 24, 'gen1.pan': 0.3,
        'env0.a': 0.001, 'env0.d': 0.7, 'env0.s': 0, 'env0.r': 0.6,
        'env1.a': 0.001, 'env1.d': 0.3, 'env1.s': 0, 'env1.r': 0.25,
        'env2.a': 0.6, 'env2.d': 2, 'env2.s': 0.3, 'env2.r': 1.5,
        'lfo0.rate': 0.22, 'lfo0.shape': 6, 'lfo0.amp': 0.5,
        'fx1.on': 1, 'fx1.type': 1, 'fx1.p1': 0.3, 'fx1.p2': 0.3, 'fx1.mix': 0.2,
        'fx2.on': 1, 'fx2.type': 4, 'fx2.p1': 0.3, 'fx2.p2': 0.5, 'fx2.p3': 0.4, 'fx2.mix': 0.28,
        'fx3.on': 1, 'fx3.type': 5, 'fx3.p1': 0.75, 'fx3.p2': 0.45, 'fx3.mix': 0.35
      },
      mods: [
        m('env1', 'gen0.level', 0.85), m('env2', 'gen1.level', 0.5),
        m('lfo1', 'gen0.cut', 0.3), m('env2', 'gen1.index', 0.35), m('lfo1', 'gen0.morph', 0.3)
      ]
    }
  ];

  /* 单个音色的响度配平（引擎级总增益） */
  var MIX = {
    '初始化': 0.9, 'DX 玻璃钟': 1.05, 'FM 低音': 0.62, '超锯齿': 1.2,
    '相位铺底': 1.45, '混沌铅音': 0.66, '塑料拨弦': 0.95, '金属打击': 1.0,
    '黑暗合唱': 1.5, '酸性 303': 0.9, '噪声上升': 0.85, '80s 铜管': 0.9,
    '数字雨': 1.35
  };
  PRESETS.forEach(function (p) {
    if (MIX[p.name] !== undefined) p.params['voice.gain'] = MIX[p.name];
  });

  var LIB = { PRESETS: PRESETS, list: function () { return PRESETS.map(function (p) { return p.name + ' · ' + p.en; }); } };

  if (typeof module !== 'undefined' && module.exports) module.exports = LIB;
  root.PLANT_PRESETS = LIB;
})(typeof self !== 'undefined' ? self : this);
