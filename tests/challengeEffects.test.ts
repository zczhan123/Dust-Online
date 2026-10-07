import { describe, it, expect } from 'vitest';
import { createChallengeGame, applyChallengeSkill, applyAction, skipInitialReroll } from '../src/core/engine/game';
import { attackDamageBonus } from '../src/core/engine/combat';
import { CHALLENGES } from '../src/core/content/challenges';
import { toMain } from './helpers';
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

  it('暗夜凶神：追加一次 8 点「不可抵挡」攻击（挑战者不能挡）', () => {
    const g = make();
    applyChallengeSkill(g, CARD, SK('z02-3'), []);
    expect(g.pendingAttack).toMatchObject({ attacker: 'B', baseValue: 8, unblockable: true, physical: false });
  });

  it('枭首：攻击骰数 > 挑战者防御骰数 → 用全部攻击骰逐个攻击（进攻击队列）', () => {
    const g = make();
    g.players.A.areas.defense = [];
    applyChallengeSkill(g, CARD, SK('z02-4'), [die('k1', 6, 'meditation')]);
    expect(g.players.B.areas.attack).toHaveLength(0); // 全部用于攻击
    expect(g.pendingAttack).toMatchObject({ attacker: 'B', baseValue: 6 });
  });

  it('枭首：攻击骰数不 > 挑战者防御骰数 → 不攻击（骰留在攻击骰区）', () => {
    const g = make();
    g.players.A.areas.defense = [die('d1', 2, 'defense'), die('d2', 3, 'defense')];
    applyChallengeSkill(g, CARD, SK('z02-4'), [die('k1', 6, 'meditation')]);
    expect(g.players.B.areas.attack.map((d) => d.value)).toEqual([6]);
    expect(g.pendingAttack).toBeNull();
  });

  it('遁入暗影：每 1 组 → 1 次 2 点攻击', () => {
    const g = make();
    applyChallengeSkill(g, CARD, SK('z02-5'), [die('s1', 4, 'meditation'), die('s2', 4, 'meditation')]);
    expect(g.pendingAttack).toMatchObject({ attacker: 'B', baseValue: 2, physical: false });
  });

  it('暂停/续跑：传奇回合在攻击处停下；挑战者响应后自动续跑并把回合交还', () => {
    const g = make();
    skipInitialReroll(g);
    // 先把传奇的第一个回合打完（逐段不抵挡）
    let guard0 = 0;
    while (g.activePlayer === 'B' && guard0++ < 30) applyAction(g, { t: 'block' });
    expect(g.activePlayer).toBe('A');
    toMain(g);
    // 清空挑战者骰：避免结束回合时触发「意志上限弃骰」待决策（那是另一个机制）
    g.players.A.areas = { attack: [], defense: [], meditation: [] };
    // 给传奇这一回合备骰（满足 完杀〔1/2/3/4〕与 暗夜凶神〔1/4/6〕各一组；开回合时还会追加 8 颗）
    g.challenge!.driven = [
      die('p1', 1, 'meditation'),
      die('p2', 2, 'meditation'),
      die('p3', 3, 'meditation'),
      die('p4', 4, 'meditation'),
      die('p5', 1, 'meditation'),
      die('p6', 4, 'meditation'),
      die('p7', 6, 'meditation'),
    ];
    applyAction(g, { t: 'advance' }); // 结束挑战者回合 → 传奇回合
    expect(g.pendingAttack).toMatchObject({ attacker: 'B', baseValue: 8, unblockable: true });
    expect(g.challenge!.resumeAt).not.toBeNull();
    const lifeA = g.players.A.life;
    // 逐段响应，直到传奇回合真正结束、交还挑战者
    let guard = 0;
    while (g.activePlayer === 'B' && guard++ < 40) applyAction(g, { t: 'block' });
    expect(g.players.A.life).toBeLessThan(lifeA);
    expect(g.activePlayer).toBe('A');
    expect(g.challenge!.resumeAt ?? null).toBeNull();
  });
});
