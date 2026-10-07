// C01 特典·突破 的选择向导：应为 **2 步**
// （①选择消耗的冥想骰 1–n 颗 → ②选择弃置对方的防御骰）。
// 曾为 3 步（先"选消耗几颗"再"选哪几颗"）——第一步多余，已合并（选几颗＝消耗几颗）。
import { describe, it, expect } from 'vitest';
import { setupGame } from '../src/core/engine/setup';
import { SKILL_SELECTION } from '../src/ui/skillSelection';
import type { Die, DiceKind, GameState } from '../src/core/model/types';

const spec = SKILL_SELECTION['c01.breakthrough'];

const die = (id: string, value: number, kind: DiceKind): Die => ({ id, value, kind });

const stepsOf = (g: GameState, chosenDice: string[][] = []) =>
  spec.steps({ state: g, player: 'A', chosenDice, options: [], numbers: [], slots: [] });

const c01 = (): GameState => {
  const g = setupGame({ seed: 1, firstPlayer: 'A', heroA: ['C01', '002', '003'], heroB: ['004', '005', '006'] });
  g.players.A.areas.meditation = [die('m0', 3, 'meditation'), die('m1', 3, 'meditation'), die('m2', 3, 'meditation')];
  g.players.B.areas.defense = [die('d0', 2, 'defense'), die('d1', 2, 'defense')];
  return g;
};

describe('C01 突破 · 选择向导步数', () => {
  it('2 步：①选消耗的冥想骰（1–n）②选弃置对方防御骰', () => {
    const g = c01();
    const s0 = stepsOf(g);
    expect(s0.length).toBe(2);
    expect(s0[0]).toMatchObject({ kind: 'dice', owner: 'self', areas: ['meditation'], min: 1, max: 3 });
    // 还没选骰 → 「弃置对方防御骰」需 0 颗
    expect(s0[1]).toMatchObject({ kind: 'dice', owner: 'opponent', areas: ['defense'], min: 0, max: 0 });
  });

  it('已选 2 颗冥想骰 → 「弃置对方防御骰」自动变 2 颗（选几颗＝弃几颗）', () => {
    const g = c01();
    const s1 = stepsOf(g, [['m0', 'm1']]);
    expect(s1[1]).toMatchObject({ kind: 'dice', owner: 'opponent', min: 2, max: 2 });
  });

  it('对方防御骰不足时按实际数量封顶', () => {
    const g = c01();
    const s2 = stepsOf(g, [['m0', 'm1', 'm2']]); // 选 3 颗，但对方只有 2 颗防御骰
    expect(s2[1]).toMatchObject({ kind: 'dice', owner: 'opponent', min: 2, max: 2 });
  });

  it('buildParams：chosenDice[0]＝消耗骰、[1]＝对方防御骰（去掉 number 步后索引不变）', () => {
    const g = c01();
    const params = spec.buildParams({
      state: g,
      player: 'A',
      chosenDice: [['m0', 'm1'], ['d0']],
      options: [],
      numbers: [],
      slots: [],
    });
    expect(params.costSlots).toEqual([{ dieIds: ['m0'] }, { dieIds: ['m1'] }]);
    expect(params.opponentDefenseDieIds).toEqual(['d0']);
  });
});
