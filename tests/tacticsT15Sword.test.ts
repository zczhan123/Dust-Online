import { describe, it, expect } from 'vitest';
import { createChallengeGame } from '../src/core/engine/game';
import { paySlots } from '../src/core/engine/effects';

/**
 * T15「影子」× 010「真实之剑」（作者/用户定 2026-10-16）：
 * - 置换的 **2 颗源骰不算「使用/消耗/弃置」** → **不**触发影子；
 * - 置换出来的 **虚拟 5 点骰算「使用」** → **会**触发影子（"虚拟骰都可以触发"）。
 */
const mk = (heldValue: number) => {
  const g = createChallengeGame({ seed: 1, cardId: 'Z09', challenger: ['010', '001', '002'], tactic: 'T15' });
  g.players.A.tactic = 'T15';
  g.players.A.tacticHeldDie = { id: 'sd', value: heldValue };
  g.players.A.tacticOnceUsed = false;
  g.players.A.areas.attack = [{ id: 'x1', value: 3, kind: 'attack' }];
  g.players.A.areas.defense = [{ id: 'x2', value: 4, kind: 'defense' }];
  g.players.A.areas.meditation = [];
  return g;
};

const convertPay = (g: ReturnType<typeof mk>) =>
  paySlots(g, 'A', [{ kind: 'attack' }], [{ dieIds: ['x1', 'x2'] }], undefined, 'attack');

const heldInAreas = (g: ReturnType<typeof mk>): boolean =>
  (['attack', 'defense', 'meditation'] as const).some((k) => g.players.A.areas[k].some((d) => d.id === 'sd'));

describe('T15 影子 × 010 真实之剑', () => {
  it('源骰点数(3)与存放骰相同 → **不触发**（源骰不算使用）', () => {
    const g = mk(3);
    convertPay(g);
    expect(heldInAreas(g)).toBe(false);
    expect(g.players.A.tacticHeldDie?.id).toBe('sd');
    expect(g.players.A.tacticOnceUsed).toBe(false);
  });

  it('虚拟 5 点与存放骰(5)相同 → **触发**（虚拟骰算使用）', () => {
    const g = mk(5);
    convertPay(g);
    expect(g.players.A.tacticHeldDie).toBeNull();
    expect(g.players.A.tacticOnceUsed).toBe(true);
    expect(heldInAreas(g)).toBe(true);
  });
});
