// 行草字体子集生成器（首页/选择页的 `--menu-brush` 用字）
//
// 背景：`public/fonts/zhimangxing-subset*.woff2` 是**按字子集**（Google Fonts `text=` 接口）。
//   · 首页/选择页新增行草文字后，若字不在子集里 → 逐字回退成系统字体（"行草混排"）。
//   · `text=` 一次最多约 **800 字**（超过会被忽略、返回整包切片）→ 本脚本按 **≤700 字/批** 拆分，
//     生成 2 个 woff2 + 各自**精确 unicode-range**（styles.css 里的标记块自动更新）。
//
// 用法（仓库根目录）：node scripts/gen-font-subset.mjs
//   · 只读源码；只写 `public/fonts/zhimangxing-subset*.woff2` + `styles.css` 的标记块
//   · 会联网（fonts.googleapis.com / fonts.gstatic.com）
//
// 导出 `fontChars(file)`：解析 woff2 的 cmap → 返回汉字集合（测试用）。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const FONT_DIR = path.join(root, 'public/fonts');
const FONT_BASE = 'zhimangxing-subset';
const CSS_REL = 'src/ui/styles.css';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
/** `text=` 超过 ~800 字会被 Google 忽略 → 每批留余量。 */
const BATCH_MAX = 700;

/* ---------- 1) 解析 woff2 → 字集（只读 cmap） ---------- */

const readBase128 = (buf, pos) => {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const b = buf[pos + i];
    value = (value << 7) | (b & 0x7f);
    if (!(b & 0x80)) return [value, pos + i + 1];
  }
  throw new Error('bad UIntBase128');
};

const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep',
  'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE',
  'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt',
  'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar',
  'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
];

/** 解析 woff2 里的 cmap 表 → 字符码点集合。 */
function woff2Chars(buf) {
  if (buf.toString('latin1', 0, 4) !== 'wOF2') throw new Error('not a woff2 file');
  const numTables = buf.readUInt16BE(12);
  const totalCompressedSize = buf.readUInt32BE(20);
  let pos = 48;
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const flags = buf[pos];
    pos += 1;
    const tagIndex = flags & 0x3f;
    const transform = (flags >> 6) & 0x03;
    const tag = tagIndex === 63 ? buf.toString('latin1', pos, (pos += 4)) : KNOWN_TAGS[tagIndex];
    let origLength;
    [origLength, pos] = readBase128(buf, pos);
    const isGlyfLoca = tag === 'glyf' || tag === 'loca';
    const transformed = isGlyfLoca ? transform !== 3 : transform !== 0;
    let dataLength = origLength;
    if (transformed) [dataLength, pos] = readBase128(buf, pos);
    tables.push({ tag, dataLength });
  }
  const raw = zlib.brotliDecompressSync(buf.subarray(pos, pos + totalCompressedSize));
  let off = 0;
  const offsets = new Map();
  for (const t of tables) {
    offsets.set(t.tag, off);
    off += t.dataLength;
  }
  if (!offsets.has('cmap')) throw new Error('no cmap');
  const cmapOff = offsets.get('cmap');
  const cmapLen = tables.find((t) => t.tag === 'cmap').dataLength;
  const cmap = raw.subarray(cmapOff, cmapOff + cmapLen);
  const numSub = cmap.readUInt16BE(2);
  const chars = new Set();
  for (let i = 0; i < numSub; i++) {
    const rec = 4 + i * 8;
    const platform = cmap.readUInt16BE(rec);
    const subOff = cmap.readUInt32BE(rec + 4);
    const format = cmap.readUInt16BE(subOff);
    if (format === 4 && (platform === 3 || platform === 0)) {
      const segX2 = cmap.readUInt16BE(subOff + 6);
      const segCount = segX2 / 2;
      const endArr = subOff + 14;
      const startArr = endArr + segX2 + 2;
      for (let s = 0; s < segCount; s++) {
        const end = cmap.readUInt16BE(endArr + s * 2);
        const start = cmap.readUInt16BE(startArr + s * 2);
        if (start === 0xffff && end === 0xffff) continue;
        for (let c = start; c <= end; c++) chars.add(c);
      }
      return chars;
    }
    if (format === 12) {
      const groups = cmap.readUInt32BE(subOff + 12);
      for (let g = 0; g < groups; g++) {
        const o = subOff + 16 + g * 12;
        const start = cmap.readUInt32BE(o);
        const end = cmap.readUInt32BE(o + 4);
        for (let c = start; c <= end; c++) chars.add(c);
      }
      return chars;
    }
  }
  return chars;
}

/** 测试/脚手架用：读 woff2 文件 → 汉字集合（只取 CJK 基本区）。 */
export function fontChars(file) {
  const out = new Set();
  for (const c of woff2Chars(fs.readFileSync(file))) {
    if (c >= 0x4e00 && c <= 0x9fff) out.add(String.fromCharCode(c));
  }
  return out;
}

/* ---------- 2) 收集"行草字体真正会渲染"的用字 ---------- */

const SOURCE_FILES = [
  'src/ui/setupScreen.ts', // 首页 / 二级菜单 / 选择页标题与竖签名
  'src/ui/lobby.ts', // 大厅标题
  'src/core/content/artifacts.ts', // 神器名 / 武器名
  'src/core/content/legends.ts', // 英雄名
  'src/core/content/legendText.ts', // 传奇英雄名
  'src/core/content/tactics.ts', // 战术名
  'src/core/content/challenges.ts', // 挑战传奇卡名 / 技能名 / 规则标题
];

const CJK = /[\u4e00-\u9fff]/g;

function collectChars() {
  const chars = new Set();
  for (const rel of SOURCE_FILES) {
    const p = path.join(root, rel);
    if (!fs.existsSync(p)) continue;
    for (const c of fs.readFileSync(p, 'utf8').match(CJK) ?? []) chars.add(c);
  }
  return chars;
}

/* ---------- 3) 联网：按字取 woff2 子集 ---------- */

async function fetchSubset(chars) {
  const url = `https://fonts.googleapis.com/css2?family=Zhi+Mang+Xing&text=${encodeURIComponent(chars.join(''))}`;
  const cssRes = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!cssRes.ok) throw new Error(`fonts.googleapis.com ${cssRes.status}`);
  const css = await cssRes.text();
  const blocks = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
  if (blocks.length !== 1) {
    throw new Error(`text= 被忽略（返回 ${blocks.length} 个字体分片）→ 本批字数太多，请调小 BATCH_MAX`);
  }
  const m = /url\((https:[^)]+)\)\s*format\((?:'|")woff2(?:'|")\)/.exec(blocks[0]);
  if (!m) throw new Error('CSS 里没有 woff2 url');
  const fontRes = await fetch(m[1], { headers: { 'User-Agent': UA } });
  if (!fontRes.ok) throw new Error(`fonts.gstatic.com ${fontRes.status}`);
  return Buffer.from(await fontRes.arrayBuffer());
}

/* ---------- 4) unicode-range（把字集压成尽量少的区间） ---------- */

function unicodeRange(chars) {
  const codes = [...chars].map((c) => c.codePointAt(0)).sort((a, b) => a - b);
  const parts = [];
  let start = codes[0];
  let prev = codes[0];
  for (const c of codes.slice(1)) {
    if (c === prev + 1) {
      prev = c;
      continue;
    }
    parts.push(start === prev ? `U+${start.toString(16)}` : `U+${start.toString(16)}-${prev.toString(16)}`);
    start = c;
    prev = c;
  }
  parts.push(start === prev ? `U+${start.toString(16)}` : `U+${start.toString(16)}-${prev.toString(16)}`);
  return parts.join(', ');
}

/* ---------- 5) 主流程 ---------- */

const CSS_START = '/* @font-subset:start（由 scripts/gen-font-subset.mjs 生成，勿手改） */';
const CSS_END = '/* @font-subset:end */';

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  fs.mkdirSync(FONT_DIR, { recursive: true });
  const target = collectChars();
  // 合并已有子集（多批都并上）→ 不丢字
  for (const f of fs.readdirSync(FONT_DIR)) {
    if (/^zhimangxing-subset.*\.woff2$/.test(f)) {
      const p = path.join(FONT_DIR, f);
      try {
        for (const c of fontChars(p)) target.add(c);
      } catch {
        /* 损坏的旧文件忽略 */
      }
    }
  }
  const chars = [...target].sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
  const batches = [];
  for (let i = 0; i < chars.length; i += BATCH_MAX) batches.push(chars.slice(i, i + BATCH_MAX));
  console.log(`[font] 目标 ${chars.length} 字 → ${batches.length} 批`);

  const written = [];
  for (let i = 0; i < batches.length; i++) {
    const name = i === 0 ? `${FONT_BASE}.woff2` : `${FONT_BASE}-${i + 1}.woff2`;
    const buf = await fetchSubset(batches[i]);
    const tmp = path.join(FONT_DIR, `${name}.tmp`);
    fs.writeFileSync(tmp, buf);
    const got = fontChars(tmp);
    const lost = batches[i].filter((c) => !got.has(c));
    if (lost.length > 0) {
      fs.rmSync(tmp, { force: true });
      throw new Error(`第 ${i + 1} 批缺字（${lost.join('')}）→ 未覆盖原文件`);
    }
    fs.renameSync(tmp, path.join(FONT_DIR, name));
    written.push({ name, chars: new Set(batches[i]) });
    console.log(`[font] ${name}：${(buf.length / 1024).toFixed(0)} KB`);
  }

  // 6) 更新 styles.css 的标记块（两个 @font-face + 精确 unicode-range）
  const cssPath = path.join(root, CSS_REL);
  const css = fs.readFileSync(cssPath, 'utf8');
  const a = css.indexOf(CSS_START);
  const b = css.indexOf(CSS_END);
  if (a < 0 || b < 0) throw new Error('styles.css 里缺少 @font-subset 标记块');
  const faces = written
    .map(
      (w) =>
        `@font-face {\n  font-family: "Zhi Mang Xing";\n  font-style: normal;\n  font-weight: 400;\n  font-display: swap;\n  src: url("/fonts/${w.name}") format("woff2");\n  unicode-range: ${unicodeRange(w.chars)};\n}`,
    )
    .join('\n');
  const next = `${css.slice(0, a + CSS_START.length)}\n${faces}\n${css.slice(b)}`;
  fs.writeFileSync(cssPath, next, 'utf8');
  console.log(`[font] styles.css 已更新（${written.length} 个 @font-face）`);
}
