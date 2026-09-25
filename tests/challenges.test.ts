import { describe, it, expect } from 'vitest';
import { CHALLENGES, slotPhrase } from '../src/core/content/challenges';

describe('挑战卡 · slotPhrase（文本记法）', () => {
  it('无槽 → （必发动）', () => {
    expect(slotPhrase(null)).toBe('（必发动）');
    expect(slotPhrase([])).toBe('（必发动）');
  });

  it('① 统一可任选 → N 个〔x/y点〕', () => {
    expect(slotPhrase([{ kind: 'pips', count: 5, faces: [2, 5] }])).toBe('（满足 5 个〔2/5点〕驱动骰时发动）');
    expect(slotPhrase([{ kind: 'pips', count: 3, faces: [2, 5] }])).toBe('（满足 3 个〔2/5点〕驱动骰时发动）');
  });

  it('② 逐格指定 → 合并成一个括号〔a点、b点…〕', () => {
    expect(
      slotPhrase([
        { kind: 'pips', count: 1, faces: [1] },
        { kind: 'pips', count: 1, faces: [2] },
        { kind: 'pips', count: 1, faces: [3] },
        { kind: 'pips', count: 1, faces: [4] },
      ]),
    ).toBe('（满足〔1点、2点、3点、4点〕驱动骰时发动）');
    expect(
      slotPhrase([
        { kind: 'pips', count: 1, faces: [1] },
        { kind: 'pips', count: 1, faces: [4] },
        { kind: 'pips', count: 1, faces: [6] },
      ]),
    ).toBe('（满足〔1点、4点、6点〕驱动骰时发动）');
  });

  it('③ 特殊 → 任意相同 / 任意 / 顺点', () => {
    expect(slotPhrase([{ kind: 'same', count: 2 }])).toBe('（满足 2 个任意相同点数驱动骰时发动）');
    expect(slotPhrase([{ kind: 'any', count: 3 }])).toBe('（满足 3 个任意点数驱动骰时发动）');
    expect(slotPhrase([{ kind: 'straight', count: 4 }])).toBe('（满足 4 个顺点驱动骰时发动）');
  });

  it('Z01/Z02 数据与记法一致（抽查）', () => {
    const z1 = CHALLENGES.find((c) => c.id === 'Z01')!;
    expect(slotPhrase(z1.skills![2].slots)).toBe('（满足 5 个〔2/5点〕驱动骰时发动）');
    expect(slotPhrase(z1.skills![3].slots)).toBe('（满足 3 个〔2/5点〕驱动骰时发动）');
    const z2 = CHALLENGES.find((c) => c.id === 'Z02')!;
    expect(slotPhrase(z2.skills![2].slots)).toBe('（满足〔1点、2点、3点、4点〕驱动骰时发动）');
    expect(slotPhrase(z2.skills![3].slots)).toBe('（满足〔1点、4点、6点〕驱动骰时发动）');
    expect(slotPhrase(z2.skills![5].slots)).toBe('（满足 2 个任意相同点数驱动骰时发动）');
  });
});
