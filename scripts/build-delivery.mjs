// 交付构建：产出「解压后双击 index.html 即玩」的【文件夹版】→ 压成 zip。
//
// 设计约束：**不改现有代码**（src/、vite.config.ts、index.html 一律不动）。
// 做法：只读现有 vite.config.ts，跑一次独立构建到 `dist-delivery/`，
//       再把产物 index.html 里的 JS/CSS 内联、绝对路径改相对、字体内联，最后压 zip。
//
// 运行：node scripts/build-delivery.mjs
import { build } from 'vite';
import { readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outRel = 'dist-delivery';
const outDir = path.join(root, outRel);

const strip = (rel) => rel.replace(/^\.?\//, ''); // './x' 或 '/x' → 'x'

console.log('[delivery] vite build（base=./）→', outRel);
await build({ root, base: './', build: { outDir: outRel, emptyOutDir: true } });

const htmlPath = path.join(outDir, 'index.html');
let html = readFileSync(htmlPath, 'utf8');

// 1) 内联 JS：<script … src="…"> → <script type="module">…</script>
html = html.replace(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g, (m, src) => {
  const p = path.join(outDir, strip(src));
  if (!existsSync(p)) return m;
  const code = readFileSync(p, 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script type="module">\n${code}\n</script>`;
});

// 2) 内联 CSS：<link rel="stylesheet" href="…"> → <style>…</style>；顺手去掉 modulepreload
html = html.replace(/<link\b[^>]*>/g, (tag) => {
  const rel = /\brel="([^"]+)"/.exec(tag)?.[1];
  const href = /\bhref="([^"]+)"/.exec(tag)?.[1];
  if (rel === 'modulepreload') return '';
  if (rel === 'stylesheet' && href) {
    const p = path.join(outDir, strip(href));
    if (existsSync(p)) return `<style>\n${readFileSync(p, 'utf8')}\n</style>`;
  }
  return tag;
});

// 3) 绝对路径 → 相对（源里写死的 '/cards/' 等；base=./ 不会改这些字面量）
for (const d of ['cards', 'legend', 'tactics']) html = html.split(`/${d}/`).join(`./${d}/`);
html = html.split('/cover.jpg').join('./cover.jpg');

// 4) 字体内联成 data URI（file:// 下浏览器常拦字体加载 → 内联最稳；**可能有多批子集**）
const fontDir = path.join(root, 'public', 'fonts');
if (existsSync(fontDir)) {
  for (const f of readdirSync(fontDir)) {
    if (!/^zhimangxing-subset.*\.woff2$/.test(f)) continue;
    const b64 = readFileSync(path.join(fontDir, f)).toString('base64');
    const esc = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp(`url\\((?:'|")?[^)'"]*${esc}(?:'|")?\\)`, 'g'), `url(data:font/woff2;base64,${b64})`);
  }
}

// 4b) **图片也内联**（CSS 里 `url(./封面-hash.jpg)` 这类相对引用）：
//     单文件版最后会删掉 assets/，不内联就会 404（封面等）。
const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};
html = html.replace(/url\((['"]?)\.\/([^)'"]+\.(?:png|jpe?g|webp|svg))\1\)/g, (m, _q, name) => {
  const p = path.join(outDir, 'assets', name);
  if (!existsSync(p)) return m;
  const ext = path.extname(name).toLowerCase();
  return `url(data:${MIME[ext] ?? 'application/octet-stream'};base64,${readFileSync(p).toString('base64')})`;
});

writeFileSync(htmlPath, html, 'utf8');

// 5) 清理已内联的 assets/（内容都在 html 里了）
const assetsDir = path.join(outDir, 'assets');
if (existsSync(assetsDir)) rmSync(assetsDir, { recursive: true, force: true });

// 6) 压 zip（用 Windows 自带 Compress-Archive；不引新依赖）
const zipPath = path.join(root, '尘起时刻-试玩.zip');
try {
  if (existsSync(zipPath)) rmSync(zipPath, { force: true });
  execFileSync(
    'powershell',
    ['-NoProfile', '-Command', `Compress-Archive -Path '${outDir}\\*' -DestinationPath '${zipPath}' -Force`],
    { stdio: 'inherit' },
  );
  console.log('[delivery] zip →', zipPath);
} catch (e) {
  console.warn('[delivery] 压缩失败（可手动压缩 dist-delivery/）：', e?.message ?? e);
}

const kb = (readFileSync(htmlPath).length / 1024).toFixed(0);
console.log(`[delivery] 完成：dist-delivery/index.html ≈ ${kb} KB。请解压 zip 后双击 index.html 实测。`);
