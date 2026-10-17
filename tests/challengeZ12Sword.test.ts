import { describe, it, expect } from 'vitest';
import { createChallengeGame } from '../src/core/engine/game';
import { canPayCosts, paySlots } from '../src/core/engine/effects';
import { SKILL_HANDLERS } from '../src/core/engine/skills';
import type { GameState } from '../src/core/model/types';

/**
 * Z12「不动菩提」× 010 真实之剑 / 005 影袭（用户定 2026-10-16）：
 * - 封锁的是「使用 / 消耗 / 弃置」某点数的能力骰；
 * - 真实之剑置换的 **2 颗源骰不算使用/消耗/弃置** → **不受封锁**；
 *   但置换出的 **有效 5 点** 要受封锁 → V=5 时置换不可用（按钮也不出现）；
 * - 影袭的"点数下降"也**不算**使用/消耗/弃置 → 不受封锁（下降后的"使用"按新点数受锁）。
 */
const mk = (lock: number | null): GameState => {
  const g = createChallengeGame({ seed: 1, cardId: 'Z12', challenger: ['010', '001', '002'] });
  g.challenge!.lockValue = lock ?? undefined;
  // 010「真实之剑」是**持续**技能：需要该神器有装填标记才生效（引擎口径）
  const sword = g.players.A.artifacts.find((a) => a.id === '010')!;
  sword.activeMarkerSide = 'left';
  g.players.A.areas.attack = [];
  g.players.A.areas.defense = [{ id: 'x1', value: 3, kind: 'defense' }];
  g.players.A.areas.meditation = [{ id: 'x2', value: 3, kind: 'meditation' }];
  return g;
};

const convert = (g: GameState) =>
  paySlots(g, 'A', [{ kind: 'attack' }], [{ dieIds: ['x1', 'x2'] }], undefined, 'attack');

describe('Z12 不动菩提 × 真实之剑 / 影袭', () => {
  it('封锁 3 点：源骰是 3,3 → **置换可用**（源骰不受锁，有效点是 5）', () => {
    const g = mk(3);
    expect(() => convert(g)).not.toThrow();
    expect(g.players.A.areas.attack).toHaveLength(0);
    expect(g.players.A.areas.defense).toHaveLength(0);
  });

  it('封锁 5 点：置换出来的有效 5 被锁 → **置换不可用**', () => {
    const g = mk(5);
    expect(() => convert(g)).toThrow(/不动菩提/);
  });

  it('封锁 5 点：无攻击骰、只能靠置换 → `canPayCosts` 为 false（按钮不出现）', () => {
    const g = mk(5);
    expect(canPayCosts(g, 'A', { attack: 1 }, { held: false })).toBe(false);
    const g2 = mk(3);
    expect(canPayCosts(g2, 'A', { attack: 1 }, { held: false })).toBe(true);
  });

  it('封锁 5 点：影袭的"点数下降"不受锁（5→3），下降后的骰照常落区', () => {
    const g = createChallengeGame({ seed: 1, cardId: 'Z12', challenger: ['005', '001', '002'] });
    g.challenge!.lockValue = 5;
    g.players.A.areas.attack = [{ id: 'd5', value: 5, kind: 'attack' }];
    g.players.A.areas.defense = [];
    g.players.A.areas.meditation = [];
    const card = g.players.A.artifacts.find((a) => a.id === '005')!;
    const run = SKILL_HANDLERS['yingle.yingxi'].run;
    run({
      g,
      player: 'A',
      artifact: card,
      params: { dieId: 'd5', x: 2 },
      rng: () => 1,
      endMainPhase: () => {},
      reportConsumed: () => {},
    } as never);
    const all = [...g.players.A.areas.attack, ...g.players.A.areas.defense, ...g.players.A.areas.meditation];
    const d = all.find((x) => x.id === 'd5');
    expect(d?.value).toBe(3);
  });
});
