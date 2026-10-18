import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// 脚本是 .mjs（无类型声明）——只借用它的 cmap 解析做断言
// @ts-ignore
import { fontChars } from '../scripts/gen-font-subset.mjs';

const dir = path.resolve(__dirname, '../public/fonts');

const allChars = (): Set<string> => {
  const out = new Set<string>();
  for (const f of fs.readdirSync(dir)) {
    if (!/^zhimangxing-subset.*\.woff2$/.test(f)) continue;
    for (const c of fontChars(path.join(dir, f)) as Set<string>) out.add(c);
  }
  return out;
};

describe('行草字体子集（--menu-brush）', () => {
  it('包含首页 / 选择页行草用字（含「关于游戏」）', () => {
    const chars = allChars();
    const need =
      '联机游戏左右互搏挑战模式图鉴查询关于游戏轮选预设构筑返回开始先手附加昔日传奇传说中的规则调整结算玩家不利自选';
    const missing = [...new Set(need)].filter((c) => !chars.has(c));
    expect(missing).toEqual([]);
  });

  it('styles.css 有 @font-subset 标记块且含 Zhi Mang Xing 的 @font-face', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../src/ui/styles.css'), 'utf8');
    expect(css).toContain('@font-subset:start');
    expect(css).toContain('@font-subset:end');
    expect(css).toMatch(/@font-face[\s\S]*?Zhi Mang Xing/);
  });
});
