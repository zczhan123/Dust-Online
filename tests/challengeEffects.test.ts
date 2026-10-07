import { describe, it, expect } from 'vitest';
import { createChallengeGame, applyChallengeSkill } from '../src/core/engine/game';
import { attackDamageBonus } from '../src/core/engine/combat';
import { CHALLENGES } from '../src/core/content/challenges';
import type { Die, DiceKind } from '../src/core/model/types';

const CARD = CHALLENGES.find((c) => c.id === 'Z02')!;
const SK = (id: string) => CARD.skills!.find((s) => s.id === id)!;
const die = (id: string, value: number, kind: DiceKind): Die => ({ id, value, kind });
const make = () => createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['001', '002', '003'] });

describe('挑战模式 · Z02 非攻击类效果', () => {
  it('葬敌的完杀：挑战者防御骰弃至剩 1；传奇获得 1/2/3/4 点攻击骰各 1', () => {
    const g = make();
    g.players.A.areas.defense = [die('a1', 2, 'defense'), die('a2', 3, 'defense'), die('a3', 4, 'defense')];
    applyChallengeSkill(g, CARD, SK('z02-2'), []);
    expect(g.players.A.areas.defense.map((d) => d.id)).toEqual(['a1']);
    expect(g.players.B.areas.attack.map((d) => d.value)).toEqual([1, 2, 3, 4]);
  });

  it('暗夜凶神：弃挑战者 1 个防御骰；计数 +1 且不超上限', () => {
    const g = make();
    g.players.A.areas.defense = [die('a1', 2, 'defense'), die('a2', 3, 'defense')];
    applyChallengeSkill(g, CARD, SK('z02-3'), []);
    expect(g.players.A.areas.defense.map((d) => d.id)).toEqual(['a2']);
    expect(g.challenge!.count).toBe(1);
    g.challenge!.count = 3; // 已满
    applyChallengeSkill(g, CARD, SK('z02-3'), []);
    expect(g.challenge!.count).toBe(3);
  });

  it('枭首：消耗的驱动骰变成传奇的攻击骰（点数保留）', () => {
    const g = make();
    applyChallengeSkill(g, CARD, SK('z02-4'), [die('drv1', 6, 'meditation'), die('drv2', 1, 'meditation')]);
    expect(g.players.B.areas.attack.map((d) => d.value).sort()).toEqual([1, 6]);
  });

  it('遁入暗影：驱动骰变成传奇防御骰，且受「防御骰上限 4」截断', () => {
    const g = make();
    applyChallengeSkill(g, CARD, SK('z02-5'), [die('drv1', 3, 'meditation'), die('drv2', 4, 'meditation')]);
    expect(g.players.B.areas.defense.map((d) => d.value).sort()).toEqual([3, 4]);
    applyChallengeSkill(
      g,
      CARD,
      SK('z02-5'),
      [
        die('x1', 1, 'meditation'),
        die('x2', 2, 'meditation'),
        die('x3', 5, 'meditation'),
        die('x4', 6, 'meditation'),
      ],
    );
    expect(g.players.B.areas.defense.length).toBe(4);
  });

  it('锋芒：传奇的攻击伤害加成 = 传奇计数（走统一口径 attackDamageBonus）', () => {
    const g = make();
    g.challenge!.count = 2;
    applyChallengeSkill(g, CARD, SK('z02-1'), []);
    expect(attackDamageBonus(g, 'B').value).toBe(2);
  });
});
