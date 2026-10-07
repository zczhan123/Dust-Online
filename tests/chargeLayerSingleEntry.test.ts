import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 门禁：第三列「充能层数」只能经**唯一入口** `chargeLayerUp`（dustRise.ts）改动。
 * 若别处再手写 `chargeLayer += 1` → 很可能像 L03「统御战场」那样漏掉"达标即激活"，测试立刻变红。
 */
describe('门禁 · 第三列充能只能走唯一入口', () => {
  it('src/core/engine/*.ts 中「chargeLayer +=」只允许出现在 dustRise.ts', () => {
    const dir = join(process.cwd(), 'src', 'core', 'engine');
    const hits: string[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.ts')) continue;
      const src = readFileSync(join(dir, f), 'utf8');
      if (/chargeLayer\s*\+=/.test(src)) hits.push(f);
    }
    expect(hits).toEqual(['dustRise.ts']);
  });
});
