import { describe, it, expect } from 'vitest';
import {
  createChallengeGame,
  createGame,
  skipInitialReroll,
  applyAction,
  applyChallengeSkill,
  getLegalActions,
} from '../src/core/engine/game';
import { legendCanBlock, isInertSkill } from '../src/core/engine/challenge';
import { CHALLENGES } from '../src/core/content/challenges';
import { toMain, driveLegendTurn } from './helpers';
import type { Die, DiceKind } from '../src/core/model/types';

const die = (id: string, value: number, kind: DiceKind): Die => ({ id, value, kind });
const Z02 = CHALLENGES.find((c) => c.id === 'Z02')!;

/** 建局并把传奇的首个回合驱动跑完，回到挑战者的主要阶段 */
const toChallengerMain = (challenger: [string, string, string]) => {
  const g = createChallengeGame({ seed: 1, cardId: 'Z02', challenger });
  skipInitialReroll(g);
  driveLegendTurn(g);
  toMain(g);
  return g;
};

describe('挑战模式 · 规则与削弱', () => {
  it('legendCanBlock：伤害 < 门槛 → 不挡', () => {
    expect(legendCanBlock(Z02, 3)).toBe(true);
    expect(legendCanBlock(Z02, 4)).toBe(true);
    expect(legendCanBlock(Z02, 2)).toBe(false);
    expect(legendCanBlock(Z02, 0)).toBe(false);
  });

  it('isInertSkill：按玩家分侧（不是按模式一刀切）；标准模式一律 false', () => {
    const chal = createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['001', '002', '003'] });
    // 028 白昼之火 / A05 深空之火：只废"打向传奇"的那一份（挑战者 A）；传奇 B 照常
    expect(isInertSkill(chal, 'A', 'tianfa.bairi')).toBe(true);
    expect(isInertSkill(chal, 'A', 'tianfa.alt.shenkong')).toBe(true);
    expect(isInertSkill(chal, 'B', 'tianfa.bairi')).toBe(false);
    expect(isInertSkill(chal, 'B', 'tianfa.alt.shenkong')).toBe(false);
    // 013 雷暴（持续）/ 017 帷幕：只废传奇 B（它没有重掷阶段）；挑战者 A 照常
    expect(isInertSkill(chal, 'B', 'minglei.leibao.continuous')).toBe(true);
    expect(isInertSkill(chal, 'B', 'youming.weimu')).toBe(true);
    expect(isInertSkill(chal, 'A', 'minglei.leibao.continuous')).toBe(false);
    expect(isInertSkill(chal, 'A', 'youming.weimu')).toBe(false);
    // 不在名单里的技能：两侧都 false
    expect(isInertSkill(chal, 'A', 'buxiang.fengmang')).toBe(false);
    expect(isInertSkill(chal, 'B', 'buxiang.fengmang')).toBe(false);
    // 标准模式：一律 false
    const std = createGame({ seed: 1, firstPlayer: 'A' });
    expect(isInertSkill(std, 'A', 'tianfa.bairi')).toBe(false);
    expect(isInertSkill(std, 'B', 'tianfa.bairi')).toBe(false);
    expect(isInertSkill(std, 'A', 'minglei.leibao.continuous')).toBe(false);
    expect(isInertSkill(std, 'B', 'youming.weimu')).toBe(false);
  });

  it('防御规则：挑战者 2 点攻击（< 门槛 3）→ 传奇不给任何抵挡动作', () => {
    const g = toChallengerMain(['001', '002', '003']);
    g.players.B.areas.defense = [die('b1', 5, 'defense')];
    g.players.A.areas.attack = [die('a1', 2, 'attack')];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    expect(getLegalActions(g).map((a) => a.t)).toEqual(['block']); // 只有"不抵挡"
  });

  it('防御规则：挑战者 4 点攻击（≥ 门槛 3）→ 传奇可抵挡（给出骰片动作）', () => {
    const g = toChallengerMain(['001', '002', '003']);
    g.players.B.areas.defense = [die('b1', 5, 'defense')];
    g.players.A.areas.attack = [die('a1', 4, 'attack')];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    expect(getLegalActions(g).some((a) => a.t === 'block' && a.costSlots)).toBe(true);
  });

  it('028「白昼之火」在挑战模式下没有任何效果（激活时）', () => {
    const g = createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['028', '002', '003'] });
    // 造尘起阶段，把 028 装填到左侧（左＝「白昼之火」，激活类技能此即强制结算）
    g.phase = 'dustRise';
    g.activePlayer = 'A';
    g.dustRiseNormalCount = 0;
    g.dustRiseActed = false;
    g.players.A.hasDustSeal = false;
    g.players.A.areas.meditation = [die('m1', 2, 'meditation')];
    applyAction(g, { t: 'dustRise', artifactId: '028', side: 'left', costSlots: [{ dieIds: ['m1'] }] });
    expect(g.tianfa.A).toBeNull();
  });

  it('代决（模式 1）：「葬敌的完杀」留哪颗防御骰交给挑战者选', () => {
    const g = toChallengerMain(['001', '002', '003']);
    g.players.A.areas = {
      attack: [],
      defense: [die('d1', 2, 'defense'), die('d2', 3, 'defense'), die('d3', 4, 'defense')],
      meditation: [],
    };
    // 备好 完杀〔1/2/3/4〕的驱动骰（开回合时还会追加）
    g.challenge!.driven = [die('q1', 1, 'meditation'), die('q2', 2, 'meditation'), die('q3', 3, 'meditation'), die('q4', 4, 'meditation')];
    applyAction(g, { t: 'advance' }); // 结束挑战者回合 → 传奇回合（逐条推进）
    // 一条一条推进，直到 完杀 的"留哪颗"代决弹出
    let guard = 0;
    while (g.activePlayer === 'B' && !g.pending && guard++ < 20) applyAction(g, { t: 'challengeStep' });
    const pd = g.pending;
    expect(pd?.kind).toBe('challengePick');
    if (pd?.kind !== 'challengePick') throw new Error('expect challengePick');
    expect(pd.player).toBe('A');
    expect(pd.options.map((o) => o.label)).toEqual(['防2', '防3', '防4']);
    // 挑战者替传奇决定：留「防3」（d2）→ 再推进一条，完杀才真正结算
    applyAction(g, { t: 'challengePick', id: 'd2' });
    applyAction(g, { t: 'challengeStep' });
    expect(g.players.A.areas.defense.map((d) => d.id)).toEqual(['d2']);
  });

  it('代决：「枭首」攻击顺序交给挑战者选（asc→先小后大）', () => {
    const g = createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['001', '002', '003'] });
    g.players.B.areas.attack = [die('b1', 5, 'attack'), die('b2', 2, 'attack')];
    g.players.A.areas.defense = [];
    g.challenge!.decisions = { 'z02-4': ['asc'] };
    const skill = Z02.skills!.find((s) => s.id === 'z02-4')!;
    applyChallengeSkill(g, Z02, skill, [die('k1', 6, 'meditation')]);
    expect(g.pendingAttack).toMatchObject({ attacker: 'B', baseValue: 2 });
  });
});
