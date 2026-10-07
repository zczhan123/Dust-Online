import { describe, it, expect } from 'vitest';
import {
  createChallengeGame,
  createGame,
  skipInitialReroll,
  applyAction,
  getLegalActions,
} from '../src/core/engine/game';
import { legendCanBlock, isInertSkill } from '../src/core/engine/challenge';
import { CHALLENGES } from '../src/core/content/challenges';
import { toMain } from './helpers';
import type { Die, DiceKind } from '../src/core/model/types';

const die = (id: string, value: number, kind: DiceKind): Die => ({ id, value, kind });
const Z02 = CHALLENGES.find((c) => c.id === 'Z02')!;

/** 建局并把传奇的首个回合跑完，回到挑战者的主要阶段 */
const toChallengerMain = (challenger: [string, string, string]) => {
  const g = createChallengeGame({ seed: 1, cardId: 'Z02', challenger });
  skipInitialReroll(g);
  let guard = 0;
  while (g.activePlayer === 'B' && guard++ < 30) applyAction(g, { t: 'block' });
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

  it('isInertSkill：只在挑战模式下生效', () => {
    const chal = createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['001', '002', '003'] });
    expect(isInertSkill(chal, 'minglei.leibao.continuous')).toBe(true);
    expect(isInertSkill(chal, 'youming.weimu')).toBe(true);
    expect(isInertSkill(chal, 'tianfa.bairi')).toBe(true);
    expect(isInertSkill(chal, 'tianfa.alt.shenkong')).toBe(true);
    expect(isInertSkill(chal, 'buxiang.fengmang')).toBe(false);
    const std = createGame({ seed: 1, firstPlayer: 'A' });
    expect(isInertSkill(std, 'minglei.leibao.continuous')).toBe(false);
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
});
