import { describe, it, expect } from 'vitest';
import { matchSlots } from '../src/core/engine/challenge';
import type { ChallengeSlot } from '../src/core/content/challenges';
import type { Die, DiceKind } from '../src/core/model/types';

const die = (id: string, value: number): Die => ({ id, value, kind: 'meditation' as DiceKind });
const S = (v: number[]): ChallengeSlot => ({ kind: 'pips', count: 1, faces: v });

describe('挑战模式 · 驱动骰槽匹配（纯函数）', () => {
  it('② 逐格指定：〔1点、2点、3点、4点〕各 1 颗', () => {
    const slots = [S([1]), S([2]), S([3]), S([4])];
    expect(matchSlots(slots, [die('a', 1), die('b', 2), die('c', 3), die('d', 4), die('e', 5)])).toEqual([
      'a', 'b', 'c', 'd',
    ]);
    expect(matchSlots(slots, [die('a', 1), die('b', 2), die('c', 3)])).toBeNull(); // 缺 4
    expect(matchSlots(slots, [die('a', 1), die('a2', 1), die('b', 2), die('c', 3)])).toBeNull(); // 两颗 1、缺 4
  });

  it('① 统一可任选：3 颗〔2/5点〕（每格 2 或 5 皆可）', () => {
    const slots: ChallengeSlot[] = [{ kind: 'pips', count: 3, faces: [2, 5] }];
    expect(matchSlots(slots, [die('a', 2), die('b', 2), die('c', 5), die('d', 6)])).toEqual(['a', 'b', 'c']);
    expect(matchSlots(slots, [die('a', 2), die('b', 2), die('d', 6)])).toBeNull(); // 只有 2 颗
  });

  it('① 单格单点：〔6点〕', () => {
    const slots: ChallengeSlot[] = [S([6])];
    expect(matchSlots(slots, [die('a', 6), die('b', 6)])).toEqual(['a']);
    expect(matchSlots(slots, [die('a', 5)])).toBeNull();
  });

  it('③ 任意相同点数：2 颗同点', () => {
    const slots: ChallengeSlot[] = [{ kind: 'same', count: 2 }];
    expect(matchSlots(slots, [die('a', 3), die('b', 3), die('c', 4)])).toEqual(['a', 'b']);
    expect(matchSlots(slots, [die('a', 3), die('c', 4)])).toBeNull();
    // 两个点数都有 ≥2 颗 → 取点数更小的那组（确定性）
    expect(matchSlots(slots, [die('a', 4), die('b', 4), die('c', 3), die('d', 3)])).toEqual(['c', 'd']);
  });

  it('③ 任意点数 / 顺点', () => {
    expect(matchSlots([{ kind: 'any', count: 3 }], [die('a', 1), die('b', 4), die('c', 6)])).toEqual(['a', 'b', 'c']);
    expect(matchSlots([{ kind: 'any', count: 3 }], [die('a', 1), die('b', 4)])).toBeNull();
    expect(
      matchSlots(
        [{ kind: 'straight', count: 4 }],
        [die('a', 2), die('b', 3), die('c', 4), die('d', 5), die('e', 6)],
      ),
    ).toEqual(['a', 'b', 'c', 'd']);
    expect(
      matchSlots([{ kind: 'straight', count: 4 }], [die('a', 1), die('b', 2), die('c', 5), die('d', 6)]),
    ).toBeNull(); // 不回绕
  });

  it('多槽必须**同时**满足（互不重复）', () => {
    const slots = [S([1]), S([4]), S([6])];
    expect(matchSlots(slots, [die('a', 1), die('b', 4), die('c', 6), die('d', 1)])).toEqual(['a', 'b', 'c']);
    expect(matchSlots(slots, [die('a', 1), die('b', 4)])).toBeNull();
    expect(matchSlots(slots, [die('a', 1), die('b', 6), die('c', 4)])).toEqual(['a', 'c', 'b']);
  });

  it('空槽＝无需驱动骰', () => {
    expect(matchSlots([], [die('a', 1)])).toEqual([]);
  });
});
