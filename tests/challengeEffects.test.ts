import { describe, it, expect } from 'vitest';
import { createChallengeGame, applyChallengeSkill, resolveLegendDeferred, applyAction, skipInitialReroll } from '../src/core/engine/game';
import { attackDamageBonus } from '../src/core/engine/combat';
import { CHALLENGES } from '../src/core/content/challenges';
import { toMain, driveLegendTurn } from './helpers';
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

  it('暗夜凶神：**先**发起 8 点攻击；弃骰与计数 +1 记为"延后一步"（卡面顺序）', () => {
    const g = make();
    g.players.A.areas.defense = [die('a1', 2, 'defense'), die('a2', 3, 'defense')];
    applyChallengeSkill(g, CARD, SK('z02-3'), []);
    expect(g.pendingAttack).toMatchObject({ attacker: 'B', baseValue: 8, unblockable: true });
    expect(g.players.A.areas.defense.map((d) => d.id)).toEqual(['a1', 'a2']); // 攻击结算前**还没弃**
    expect(g.challenge!.count).toBe(0);
    expect(g.challenge!.deferred).toEqual({ skillId: 'z02-3', step: 0 });
  });

  it('暗夜凶神：攻击结算完回到传奇回合 → **才**问"弃哪颗防御骰"，然后计数 +1', () => {
    const g = make();
    skipInitialReroll(g);
    g.challenge!.driven = [die('p1', 1, 'meditation'), die('p4', 4, 'meditation'), die('p6', 6, 'meditation')];
    g.players.A.areas.defense = [die('a1', 2, 'defense'), die('a2', 3, 'defense')];
    let guard = 0;
    while (g.activePlayer === 'B' && !g.pendingAttack && !g.pending && guard++ < 20) {
      applyAction(g, { t: 'challengeStep' });
    }
    expect(g.pendingAttack).toMatchObject({ baseValue: 8, unblockable: true });
    expect(g.players.A.areas.defense.map((d) => d.id)).toEqual(['a1', 'a2']); // 攻击前没弃
    applyAction(g, { t: 'block' }); // 挑战者承受这次攻击 → 攻击结算
    // 回到传奇回合：这一步就该问"弃哪颗防御骰"（延后一步）
    let guard2 = 0;
    while (!g.pending && g.activePlayer === 'B' && guard2++ < 6) applyAction(g, { t: 'challengeStep' });
    expect(g.pending?.kind).toBe('challengePick');
    if (g.pending?.kind !== 'challengePick') throw new Error('expect challengePick');
    applyAction(g, { t: 'challengePick', id: 'a1' });
    // 选择收齐 → 下一次 challengeStep 收尾"延后一步"（弃骰 + 计数 +1）
    applyAction(g, { t: 'challengeStep' });
    expect(g.players.A.areas.defense.map((d) => d.id)).toEqual(['a2']);
    expect(g.challenge!.count).toBe(1);
    expect(g.challenge!.deferred).toBeUndefined();
  });

  it('枭首：消耗的驱动骰变成传奇的攻击骰（点数保留）', () => {
    const g = make();
    applyChallengeSkill(g, CARD, SK('z02-4'), [die('drv1', 6, 'meditation'), die('drv2', 1, 'meditation')]);
    expect(g.players.B.areas.attack.map((d) => d.value).sort()).toEqual([1, 6]);
  });

  it('遁入暗影：激活时**只扣驱动骰、记下分组**（顺序 A：移入/攻击推迟到后续步）', () => {
    const g = make();
    applyChallengeSkill(g, CARD, SK('z02-5'), [die('drv1', 3, 'meditation'), die('drv2', 3, 'meditation')]);
    expect(g.pendingAttack).toBeNull(); // 激活本身**不发起攻击**
    expect(g.players.B.areas.defense).toHaveLength(0); // 也**未移入**
    expect(g.challenge!.deferred).toMatchObject({ skillId: 'z02-5', step: 0, groups: [[3, 3]] });
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

  it('枭首：攻击骰数 > 挑战者防御骰数 → 用全部攻击骰逐个攻击（进攻击队列；骰子仍在区里，**结算后才移走**）', () => {
    const g = make();
    g.players.A.areas.defense = [];
    applyChallengeSkill(g, CARD, SK('z02-4'), [die('k1', 6, 'meditation')]);
    // 发起攻击时骰子**留在攻击骰区**（界面里"新骰进区并与旧骰并排"才不会重叠）
    expect(g.players.B.areas.attack).toHaveLength(1);
    expect(g.pendingAttack).toMatchObject({ attacker: 'B', baseValue: 6 });
    // 挑战者承受这次攻击 → 结算 → 该骰才从攻击骰区移走
    applyAction(g, { t: 'block' });
    expect(g.players.B.areas.attack).toHaveLength(0);
  });

  it('枭首：攻击骰数不 > 挑战者防御骰数 → 不攻击（骰留在攻击骰区）', () => {
    const g = make();
    g.players.A.areas.defense = [die('d1', 2, 'defense'), die('d2', 3, 'defense')];
    applyChallengeSkill(g, CARD, SK('z02-4'), [die('k1', 6, 'meditation')]);
    expect(g.players.B.areas.attack.map((d) => d.value)).toEqual([6]);
    expect(g.pendingAttack).toBeNull();
  });

  it('遁入暗影：逐组「先移入本组 → 再 2 点攻击」（顺序 A，由 deferred 接力）', () => {
    const g = make();
    applyChallengeSkill(g, CARD, SK('z02-5'), [die('s1', 4, 'meditation'), die('s2', 4, 'meditation')]);
    expect(g.pendingAttack).toBeNull(); // 激活时不攻击
    resolveLegendDeferred(g, CARD); // 移入本组 + 发起本组攻击
    expect(g.players.B.areas.defense.map((d) => d.value)).toEqual([4, 4]); // **先**移入
    expect(g.pendingAttack).toMatchObject({
      attacker: 'B',
      baseValue: 2,
      physical: false,
      legendGroup: { index: 1, total: 1 },
    });
  });

  it('逐条推进：传奇回合按 challengeStep 一条条走；攻击处停下等响应，响应后继续到交还', () => {
    const g = make();
    skipInitialReroll(g);
    // 先把首个传奇回合驱动跑完
    driveLegendTurn(g);
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
    applyAction(g, { t: 'advance' }); // 结束挑战者回合 → 传奇回合（投骰后停住）
    expect(g.activePlayer).toBe('B');
    expect(g.challenge!.driven.length).toBeGreaterThan(0); // 骰子停在"临时驱动骰区域"
    // 逐条推进，直到"暗夜凶神"发起攻击处停下
    let guard = 0;
    while (g.activePlayer === 'B' && !g.pendingAttack && !g.pending && guard++ < 20) {
      applyAction(g, { t: 'challengeStep' });
    }
    expect(g.pendingAttack).toMatchObject({ attacker: 'B', baseValue: 8, unblockable: true });
    const lifeA = g.players.A.life;
    applyAction(g, { t: 'block' }); // 挑战者不抵挡 → 受伤
    expect(g.players.A.life).toBeLessThan(lifeA);
    // 继续推进到传奇回合结束（途中可能出现代决 → 取第一项）
    let guard2 = 0;
    while (g.activePlayer === 'B' && guard2++ < 80) {
      if (g.pendingAttack) applyAction(g, { t: 'block' });
      else if (g.pending?.kind === 'challengePick') applyAction(g, { t: 'challengePick', id: g.pending.options[0].id });
      else applyAction(g, { t: 'challengeStep' });
    }
    expect(g.activePlayer).toBe('A');
    expect(g.challenge!.slot).toEqual([]);
  });
});
