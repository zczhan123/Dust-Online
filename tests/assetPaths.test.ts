import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * 门禁：**资源路径禁止写成站点绝对路径**（`/cards/...`、`/legend/...`、`/tactics/...` 等）。
 * 原因：产物要能在**根目录 / 子路径**下都正常运行（`vite.config.ts` 的 `base:'./'`）。
 *
 * 例外（白名单）：
 * - `index.html` 的 `/src/main.ts`＝Vite 入口，构建时会被改写；
 * - `styles.css` 的 `url("/fonts/…")`＝`public/` 资源的字体（Vite 不改写 public 的绝对 URL）→ 目前只支持**根目录部署**（子路径需另做）。
 */

const root = process.cwd();

function walk(dir: string, ext: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, ext, out);
    else if (name.endsWith(ext)) out.push(p);
  }
  return out;
}

const ASSET_ABS = /['"`]\/(?:cards|legend|tactics|fonts|cover)\b/;

describe('资源路径门禁（禁止站点绝对路径）', () => {
  it('src/**/*.ts 里不得出现 /cards、/legend、/tactics、/fonts、/cover 开头的字符串', () => {
    const bad: string[] = [];
    for (const file of walk(path.join(root, 'src'), '.ts')) {
      const rel = path.relative(root, file);
      readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (ASSET_ABS.test(line)) bad.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(bad).toEqual([]);
  });

  it('index.html 只允许 /src/main.ts（Vite 入口）这类绝对引用', () => {
    const html = readFileSync(path.join(root, 'index.html'), 'utf8');
    const abs = [...html.matchAll(/(?:src|href)="(\/[^"]*)"/g)].map((m) => m[1]);
    expect(abs.filter((x) => x !== '/src/main.ts')).toEqual([]);
  });

  it('styles.css 的 url() 只能用相对路径 / data: / #片段（SVG 滤镜）；public 字体是白名单例外', () => {
    const css = readFileSync(path.join(root, 'src/ui/styles.css'), 'utf8');
    const urls = [...css.matchAll(/url\((['"]?)([^)'"]+)\1\)/g)].map((m) => m[2]);
    const bad = urls.filter(
      (u) =>
        !/^(\.|data:|#)/.test(u) && !/^\/fonts\/zhimangxing-subset(-\d+)?\.woff2$/.test(u),
    );
    expect(bad).toEqual([]);
  });
});
