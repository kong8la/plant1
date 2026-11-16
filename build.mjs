/* 把 src/ 下的 css/js 内联进单文件 play/index.html */
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const read = (p) => fs.readFileSync(path.join(dir, p), 'utf8');

const css = read('src/style.css');
const engine = read('src/engine.js');
const presets = read('src/presets.js');
const ui = read('src/ui.js');
let html = read('src/index.html');

const inline = (src, token, code) => src.split(token).join(code);

if (engine.includes('</script')) throw new Error('engine 源码里出现了 </script>，会破坏内联');
if (presets.includes('</script')) throw new Error('presets 源码里出现了 </script>');

html = inline(html, '/*@CSS*/', css);
html = inline(html, '/*@ENGINE*/', engine);
html = inline(html, '/*@PRESETS*/', presets);
html = inline(html, '/*@UI*/', ui);

fs.mkdirSync(path.join(dir, 'play'), { recursive: true });
fs.writeFileSync(path.join(dir, 'play', 'index.html'), html);
console.log('play/index.html', (html.length / 1024).toFixed(1) + ' KB');
