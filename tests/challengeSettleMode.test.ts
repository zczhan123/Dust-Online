import { describe, it, expect } from 'vitest';
import { createChallengeGame, applyAction, skipInitialReroll } from '../src/core/engine/game';
import type { Die, DiceKind } from '../src/core/model/types';

const die = (id: string, value: number, kind: DiceKind = 'meditation'): Die => ({ id, value, kind });
const make = (mode: 'manual' | 'favor' | 'against') =>
  createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['001', '002', '003'], settleMode: mode });

describe('挑战模式 · 结算模式（自动·有利/不利）', () => {
  it('枭首·攻击顺序：有利＝大→小；不利＝小→大', () => {
    for (const [mode, expectSeq] of [
      ['favor', [6, 2, 1]],
      ['against', [1, 2, 6]],
    ] as const) {
      const g = make(mode);
      skipInitialReroll(g);
      g.challenge!.resumeAt = 4; // z02-4 枭首
      g.challenge!.driven = [die('d6', 6)];
      g.players.B.areas.attack = [die('a1', 1, 'attack'), die('a2', 2, 'attack')];
      g.players.A.areas.defense = [];
      applyAction(g, { t: 'challengeStep' }); // 枭首：先把驱动骰移入攻击骰区（本步不攻击）
      applyAction(g, { t: 'challengeStep' }); // 移入之后 → 自动定顺序并逐个攻击
      const seq = [g.pendingAttack?.baseValue, ...(g.virtualQueue ?? []).map((x) => x.value)];
      expect(seq).toEqual(expectSeq);
    }
  });

  it('葬敌的完杀·留哪颗：有利＝留最大；不利＝留最小', () => {
    for (const [mode, kept] of [
      ['favor', 5],
      ['against', 2],
    ] as const) {
      const g = make(mode);
      skipInitialReroll(g);
      g.challenge!.resumeAt = 2; // z02-2
      g.challenge!.driven = [die('d1', 1), die('d2', 2), die('d3', 3), die('d4', 4)];
      g.players.A.areas.defense = [die('ad2', 2, 'defense'), die('ad5', 5, 'defense')];
      applyAction(g, { t: 'challengeStep' });
      expect(g.players.A.areas.defense.map((d) => d.value)).toEqual([kept]);
    }
  });

  it('暗夜凶神·弃哪颗：有利＝弃最小（留最大）；不利＝弃最大', () => {
    for (const [mode, kept] of [
      ['favor', 5],
      ['against', 2],
    ] as const) {
      const g = make(mode);
      skipInitialReroll(g);
      g.challenge!.resumeAt = 3; // z02-3
      g.challenge!.driven = [die('d1', 1), die('d4', 4), die('d6', 6)];
      g.players.A.areas.defense = [die('ad2', 2, 'defense'), die('ad5', 5, 'defense')];
      applyAction(g, { t: 'challengeStep' }); // 发起 8 点攻击
      expect(g.pendingAttack).toMatchObject({ baseValue: 8, unblockable: true });
      applyAction(g, { t: 'block' }); // 承受攻击 → 结算
      applyAction(g, { t: 'challengeStep' }); // 延后一步：自动弃骰 + 计数+1
      expect(g.players.A.areas.defense.map((d) => d.value)).toEqual([kept]);
      expect(g.challenge!.count).toBe(1);
    }
  });

  it('自选模式：仍会挂 challengePick（不改现状）', () => {
    const g = make('manual');
    skipInitialReroll(g);
    g.challenge!.resumeAt = 2;
    g.challenge!.driven = [die('d1', 1), die('d2', 2), die('d3', 3), die('d4', 4)];
    g.players.A.areas.defense = [die('ad2', 2, 'defense'), die('ad5', 5, 'defense')];
    applyAction(g, { t: 'challengeStep' });
    expect(g.pending?.kind).toBe('challengePick');
  });

  it('遁入暗影·选组：有利＝点数小的组；不利＝点数大的组（最多 2 组）', () => {
    for (const [mode, expected] of [
      ['favor', [[2, 2], [4, 4]]],
      ['against', [[6, 6], [4, 4]]],
    ] as const) {
      const g = make(mode);
      skipInitialReroll(g);
      g.challenge!.resumeAt = 5; // z02-5
      g.challenge!.driven = [
        die('d2a', 2), die('d2b', 2), die('d4a', 4), die('d4b', 4), die('d6a', 6), die('d6b', 6),
      ];
      g.players.B.areas.defense = [];
      g.players.A.areas.defense = [];
      applyAction(g, { t: 'challengeStep' });
      expect(g.challenge!.deferred).toMatchObject({ groups: expected });
    }
  });

  it('遁入暗影·自选：候选组 > 2 时弹面板让玩家选，按所选组结算', () => {
    const g = make('manual');
    skipInitialReroll(g);
    g.challenge!.resumeAt = 5;
    g.challenge!.driven = [
      die('d2a', 2), die('d2b', 2), die('d4a', 4), die('d4b', 4), die('d6a', 6), die('d6b', 6),
    ];
    g.players.B.areas.defense = [];
    g.players.A.areas.defense = [];
    applyAction(g, { t: 'challengeStep' });
    expect(g.pending?.kind).toBe('challengePick');
    if (g.pending?.kind !== 'challengePick') throw new Error('expect challengePick');
    expect(g.pending.options.map((o) => o.label)).toEqual(['2点组、4点组', '2点组、6点组', '4点组、6点组']);
    applyAction(g, { t: 'challengePick', id: '1,2' }); // 选 4点组 + 6点组
    applyAction(g, { t: 'challengeStep' });
    expect(g.challenge!.deferred).toMatchObject({ groups: [[4, 4], [6, 6]] });
  });
});
