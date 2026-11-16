import fs from 'node:fs';
const p = 'C:/Users/sunin/Documents/deepseek-harness/default-workspace/fm1-phase-plant/flash/index.html';
let s = fs.readFileSync(p, 'utf8');
const before = s;

s = s.replace(
  '在浏览器里把 <b>.fwsc</b> 固件包写进 M-VAVE FM-1：选包 → 校验 → 连接 → 写入 → 设备重启后自报身份确认。\n    大约一分钟，走的是 FM-1 自己的 USB-MIDI 升级协议（M-UPGRADE 兼容）。',
  '打开页面就会自动拉取站上的 <b>PLANT-1 M1</b> 并校验 SHA-256；接上 FM-1、勾选确认、按下安装即可。\n    大约一分钟，走的是 FM-1 自己的 USB-MIDI 升级协议（M-UPGRADE 兼容），也可以展开换成你电脑上的 <b>.fwsc</b>。'
);
s = s.replace(
  '上面第二个候选是 <b>PLANT-1 M0</b>：把浏览器版的引擎搬上真机的第一个里程碑，一个 FM 音色 + 包络 + 27 键。',
  '默认装的是站上的 <b>PLANT-1 M1</b>；要刷别的固件（Golf / 原厂包）就展开「或使用电脑上的 .fwsc 文件」。'
);
if (s === before) throw new Error('nothing replaced');
fs.writeFileSync(p, s, 'utf8');
console.log('copy updated');
