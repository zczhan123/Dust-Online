import { describe, it, expect } from 'vitest';
import { createChallengeGame, applyAction, skipInitialReroll } from '../src/core/engine/game';
import type { Die, DiceKind, GameState } from '../src/core/model/types';

const die = (id: string, value: number, kind: DiceKind = 'meditation'): Die => ({ id, value, kind });
const make = (mode: 'manual' | 'favor' | 'against' = 'manual') =>
  createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['001', '002', '003'], settleMode: mode });

/** 把局面停在"轮到传奇、下一条＝遁入暗影（z02-5 = skills[5]）"。 */
function atTundun(g: GameState, drivenVals: number[], defenseVals: number[]): void {
  skipInitialReroll(g);
  g.challenge!.resumeAt = 5;
  g.challenge!.driven = drivenVals.map((v, i) => die(`drv${i}`, v));
  g.players.B.areas.defense = defenseVals.map((v, i) => die(`bd${i}`, v, 'defense'));
  g.players.A.areas.defense = [];
}

const defVals = (g: GameState): number[] => g.players.B.areas.defense.map((d) => d.value).sort();

describe('挑战模式 · 遁入暗影（逐组 攻击→移入，上限"超出不获得"）', () => {
  it('例①：驱动 3,3,3,5 / 防 2 → 攻击 1 次、移入 2 颗（散骰留在 driven）', () => {
    const g = make();
    atTundun(g, [3, 3, 3, 5], [1, 1]);
    applyAction(g, { t: 'challengeStep' }); // 激活：成组 + 发起第 1 组攻击
    expect(g.pendingAttack).toMatchObject({ attacker: 'B', baseValue: 2 });
    expect(g.challenge!.driven.map((d) => d.value).sort()).toEqual([3, 5]); // 零头 3 与孤独 5 留下
    expect(defVals(g)).toEqual([1, 1]); // 攻击前**未移入**
    applyAction(g, { t: 'block' }); // 挑战者承受该组攻击
    applyAction(g, { t: 'challengeStep' }); // 攻击结算后 → 移入该组
    expect(defVals(g)).toEqual([1, 1, 3, 3]);
    expect(g.challenge!.deferred).toBeUndefined();
  });

  it('例②：驱动 3,3 / 防已满 4 → 攻击 1 次、不移入', () => {
    const g = make();
    atTundun(g, [3, 3], [1, 1, 1, 1]);
    applyAction(g, { t: 'challengeStep' });
    expect(g.pendingAttack).toMatchObject({ attacker: 'B', baseValue: 2 });
    applyAction(g, { t: 'block' });
    applyAction(g, { t: 'challengeStep' });
    expect(defVals(g)).toEqual([1, 1, 1, 1]); // 满 4 → 不动
    expect(g.challenge!.deferred).toBeUndefined();
  });

  it('例③：驱动 3,3,3 / 防 3 → 攻击 1 次、移入 1 颗（填到上限、不挤旧）', () => {
    const g = make();
    atTundun(g, [3, 3, 3], [1, 1, 1]);
    applyAction(g, { t: 'challengeStep' });
    applyAction(g, { t: 'block' });
    applyAction(g, { t: 'challengeStep' });
    expect(defVals(g)).toEqual([1, 1, 1, 3]); // 3+1=4，旧的 1 仍在（不挤出）
    expect(g.players.B.areas.defense).toHaveLength(4);
  });

  it('双组：驱动 3,3,5,5 → 两次攻击、逐组移入（先攻后移）', () => {
    const g = make();
    atTundun(g, [3, 3, 5, 5], []);
    applyAction(g, { t: 'challengeStep' }); // 第 1 组攻击
    expect(g.pendingAttack).toMatchObject({ baseValue: 2 });
    expect(defVals(g)).toEqual([]);
    applyAction(g, { t: 'block' });
    applyAction(g, { t: 'challengeStep' }); // 移入第 1 组 → 发起第 2 组
    expect(defVals(g)).toEqual([3, 3]);
    expect(g.pendingAttack).toMatchObject({ baseValue: 2 });
    applyAction(g, { t: 'block' });
    applyAction(g, { t: 'challengeStep' }); // 移入第 2 组
    expect(defVals(g)).toEqual([3, 3, 5, 5]);
    expect(g.challenge!.deferred).toBeUndefined();
  });

  it('候选 > 2 组：有利模式只取 2 组（点数最小优先），其余留在 driven', () => {
    const g = make('favor');
    atTundun(g, [2, 2, 4, 4, 6, 6], []);
    applyAction(g, { t: 'challengeStep' });
    expect(g.challenge!.deferred).toMatchObject({ groups: [[2, 2], [4, 4]] });
    expect(g.challenge!.driven.map((d) => d.value).sort()).toEqual([6, 6]);
  });
});
