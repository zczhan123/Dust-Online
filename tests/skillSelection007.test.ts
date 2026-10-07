// 007 战争横扫 · 交互缩短（6 下 → 2 步）：消耗 3 类各 1 颗（一步）→ 弃对方 3 类各 0–1 颗（一步）
import { describe, it, expect } from 'vitest';
import { createGame, skipInitialReroll } from '../src/core/engine/game';
import { SKILL_SELECTION } from '../src/ui/skillSelection';
import type { DiceKind, GameState } from '../src/core/model/types';

const mk = (): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['007', '002', '003'], heroB: ['001', '005', '006'] });
  skipInitialReroll(g);
  g.players.A.areas = {
    attack: [{ id: 'a1', value: 2, kind: 'attack' }],
    defense: [{ id: 'd1', value: 4, kind: 'defense' }],
    meditation: [{ id: 'm1', value: 6, kind: 'meditation' }],
  };
  g.players.B.areas = {
    attack: [{ id: 'ba', value: 1, kind: 'attack' }],
    defense: [{ id: 'bd', value: 3, kind: 'defense' }],
    meditation: [{ id: 'bm', value: 5, kind: 'meditation' }],
  };
  return g;
};
const dv = (id: string, value: number, kind: DiceKind) => ({ id, value, kind });
const stepsOf = (g: GameState) =>
  SKILL_SELECTION['zhuzai.sweep'].steps({ state: g, player: 'A', chosenDice: [], options: [], numbers: [], slots: [] });

describe('007 战争横扫 · 2 步交互', () => {
  it('只有 2 步：代价（3 类各 1）+ 弃置（对方 3 类各 0–1）', () => {
    const s = stepsOf(mk());
    expect(s.map((x) => x.kind)).toEqual(['dice', 'dice']);
    const [cost, disc] = s;
    if (cost.kind !== 'dice' || disc.kind !== 'dice') throw new Error('expect dice');
    expect(cost.owner).toBe('self');
    expect(cost.min).toBe(3);
    expect(cost.max).toBe(3);
    expect(cost.areas).toEqual(['attack', 'defense', 'meditation']);
    expect(disc.owner).toBe('opponent');
    // 「能弃则必须弃」：对方有的类别各必弃 1 颗 → 本例对方三类都有 → 3 颗
    expect(disc.min).toBe(3);
    expect(disc.max).toBe(3);
  });

  it('「能弃则必须弃」：对方缺类 → 只列有的类别且必弃数=类别数；对方全空 → 无弃置步', () => {
    const g = mk();
    g.players.B.areas.attack = [];
    g.players.B.areas.meditation = [];
    const s1 = stepsOf(g);
    expect(s1.map((x) => x.kind)).toEqual(['dice', 'dice']);
    const disc1 = s1[1];
    if (disc1.kind !== 'dice') throw new Error('expect dice');
    expect(disc1.areas).toEqual(['defense']);
    expect(disc1.min).toBe(1);
    expect(disc1.max).toBe(1);

    for (const k of ['attack', 'defense', 'meditation'] as const) g.players.B.areas[k] = [];
    expect(stepsOf(g).map((x) => x.kind)).toEqual(['dice']); // 对方全空 → 整步省略
  });

  it('代价校验：三类各 1 颗 ✓；缺类 / 重复类 / 不足 3 颗 ✗', () => {
    const cost = stepsOf(mk())[0];
    if (cost.kind !== 'dice') throw new Error('expect dice');
    expect(cost.validate!([dv('a', 2, 'attack'), dv('d', 4, 'defense'), dv('m', 6, 'meditation')]).ok).toBe(true);
    expect(cost.validate!([dv('a', 2, 'attack'), dv('a2', 5, 'attack'), dv('m', 6, 'meditation')]).ok).toBe(false); // 缺防御
    expect(cost.validate!([dv('a', 2, 'attack'), dv('d', 4, 'defense')]).ok).toBe(false); // 不足 3 颗
  });

  it('弃置校验：每种类型最多 1 颗（同类型两颗 ✗）', () => {
    const disc = stepsOf(mk())[1];
    if (disc.kind !== 'dice') throw new Error('expect dice');
    expect(disc.validate!([]).ok).toBe(true);
    expect(disc.validate!([dv('ba', 1, 'attack'), dv('bm', 5, 'meditation')]).ok).toBe(true);
    expect(disc.validate!([dv('ba', 1, 'attack'), dv('ba2', 2, 'attack')]).ok).toBe(false);
  });

  it('buildParams：乱序点选也按 [攻,防,冥] 归位；弃置按类型映射（可缺类）', () => {
    const g = mk();
    const bp = SKILL_SELECTION['zhuzai.sweep'].buildParams({
      state: g,
      player: 'A',
      chosenDice: [['m1', 'a1', 'd1'], ['bm', 'ba']], // 乱序 + 只弃攻/冥两类
      options: [],
      numbers: [],
      slots: [],
    }) as { costSlots: { dieIds: string[] }[]; discard: Record<string, string | undefined> };
    expect(bp.costSlots).toEqual([{ dieIds: ['a1'] }, { dieIds: ['d1'] }, { dieIds: ['m1'] }]);
    expect(bp.discard).toEqual({ attack: 'ba', defense: undefined, meditation: 'bm' });
  });
});
