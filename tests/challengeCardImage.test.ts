import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { challengeImageUrl } from '../src/ui/render';
import { CHALLENGES } from '../src/core/content/challenges';

describe('挑战卡图 · 文件名映射与资源存在', () => {
  it('challengeImageUrl：卡 id（2 位）→ 入库文件名（3 位编号）', () => {
    expect(challengeImageUrl('Z01')).toBe('./challenges/Z001.jpg');
    expect(challengeImageUrl('Z02')).toBe('./challenges/Z002.jpg');
    expect(challengeImageUrl('Z12')).toBe('./challenges/Z012.jpg');
  });

  it('每张挑战卡的图都真实存在于 public/challenges（防再次裂图）', () => {
    const dir = resolve(process.cwd(), 'public/challenges');
    const files = new Set(readdirSync(dir));
    const missing = CHALLENGES.map((c) => challengeImageUrl(c.id).replace('./challenges/', '')).filter(
      (f) => !files.has(f),
    );
    expect(missing).toEqual([]);
  });
});
