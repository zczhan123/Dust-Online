// 战术牌 T15「影子」：第一个回合开始放 1 个任意点数骰于战术上；使用同点数骰后移入对应区域（整局 1 次）
import { describe, it, expect } from 'vitest';
import { createGame, applyAction, skipInitialReroll } from '../src/core/engine/game';
import { paySlots } from '../src/core/engine/effects';
import { fxTake } from '../src/core/engine/fx';
import { TACTIC_POOL } from '../src/core/content/tactics';
import { areaOf } from '../src/core/model/dice';
import type { GameState } from '../src/core/model/types';

const mk = (): GameState => {
  const g = createGame({
    seed: 1,
    firstPlayer: 'A',
    heroA: ['001', '002', '003'],
    heroB: ['001', '002', '003'],
    tacticA: 'T15',
    tacticB: 'T04',
  });
  skipInitialReroll(g);
  return g;
};
const distOf = (g: GameState) => g.players.A.artifacts.find((a) => a.column === 2)!.distribution!;

describe('T15「影子」', () => {
  it('第一个回合开始时：待决策选点数 → 存放于战术上', () => {
    const g = mk();
    expect(g.pending?.kind).toBe('yingziPick');
    applyAction(g, { t: 'yingziPick', value: 5 });
    expect(g.players.A.tacticHeldDie).toEqual({ id: expect.any(String), value: 5 });
    expect(g.pending ?? null).toBeNull();
  });

  it('使用同点数能力骰 → 存放骰移入对应区域（整局 1 次）', () => {
    const g = mk();
    applyAction(g, { t: 'yingziPick', value: 5 });
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.A.areas.attack = [{ id: 'a5', value: 5, kind: 'attack' }];
    g.players.B.areas.defense = [];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a5'] }] });
    expect(areaOf(5, distOf(g))).toBe('meditation');
    expect(g.players.A.areas.meditation.some((d) => d.value === 5)).toBe(true);
    expect(g.players.A.tacticHeldDie ?? null).toBeNull();
    expect(g.players.A.tacticOnceUsed).toBe(true);
  });

  it('使用不同点数的能力骰 → 不移入', () => {
    const g = mk();
    applyAction(g, { t: 'yingziPick', value: 5 });
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.A.areas.attack = [{ id: 'a4', value: 4, kind: 'attack' }];
    g.players.B.areas.defense = [];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a4'] }] });
    expect(g.players.A.tacticHeldDie).toEqual({ id: expect.any(String), value: 5 });
    expect(g.players.A.tacticOnceUsed).toBe(false);
  });

  it('「消耗」（技能代价，reason=skill）不触发——只认「使用」', () => {
    const g = mk();
    applyAction(g, { t: 'yingziPick', value: 5 });
    g.players.A.areas.attack = [{ id: 'a5', value: 5, kind: 'attack' }];
    paySlots(g, 'A', [{ kind: 'attack' }], [{ dieIds: ['a5'] }], undefined, 'skill');
    expect(g.players.A.tacticHeldDie).toEqual({ id: expect.any(String), value: 5 });
    expect(g.players.A.tacticOnceUsed).toBe(false);
  });

  it('初始生命修正：自己 +1、对方 −1', () => {
    const base = createGame({ seed: 1, firstPlayer: 'A' });
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T15', tacticB: 'T04' });
    expect(g.players.A.life).toBe(base.players.A.life + 1);
    expect(g.players.B.life).toBe(base.players.B.life - 1);
  });

  it('TACTIC_POOL 含 T15', () => {
    expect(TACTIC_POOL).toContain('T15');
  });
});

// T15 × 010「真实之剑」：置换出的「视为 5 点」的有效骰，是否算"使用了 5 点能力骰"。
// 口径依据 FAQ 10.1.1 / 11.2.1（「2 颗当作 1 颗、视为 5 点」）→ 只当存放骰恰为 5 点时才触发。
describe('T15「影子」× 010 真实之剑（置换）', () => {
  const mkSword = (): GameState => {
    const g = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['010', '002', '003'],
      heroB: ['001', '002', '003'],
      tacticA: 'T15',
      tacticB: 'T04',
    });
    skipInitialReroll(g);
    g.players.A.artifacts.find((a) => a.id === '010')!.activeMarkerSide = 'left'; // 真实之剑·持续
    return g;
  };
  /** 用 2 颗任意骰置换出 1 个攻击骰位（有效值视为 5）发起攻击 */
  const attackWithSubstitution = (g: GameState): void => {
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.A.areas.attack = [];
    g.players.A.areas.defense = [
      { id: 'd1', value: 2, kind: 'defense' },
      { id: 'd2', value: 3, kind: 'defense' },
    ];
    g.players.B.areas.defense = [];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['d1', 'd2'] }] });
  };

  it('存放骰=5 + 置换（视为 5 点）→ 触发影子（并同帧弹「真实之剑」名）', () => {
    const g = mkSword();
    applyAction(g, { t: 'yingziPick', value: 5 });
    const hid = g.players.A.tacticHeldDie!.id;
    attackWithSubstitution(g);

    expect(g.players.A.tacticOnceUsed).toBe(true);
    expect(g.players.A.tacticHeldDie ?? null).toBeNull();
    // 按"第二列神器分布"落区（本局 002 的分布：5 点在冥想）
    expect(areaOf(5, distOf(g))).toBe('meditation');
    expect(g.players.A.areas.meditation.some((d) => d.value === 5)).toBe(true);

    const evs = fxTake();
    // 动画：存放骰 战术栏 → 中间 → 对应区
    expect(evs).toContainEqual({ kind: 'move', player: 'A', dieIds: [hid], fromCard: [hid] });
    // P0：置换支付同帧弹「真实之剑」名
    expect(evs.some((e) => e.kind === 'skillFired' && e.skillKey === 'shenhong.sword')).toBe(true);
  });

  it('存放骰=4 + 置换（视为 5 点）→ 不触发（点数不同）', () => {
    const g = mkSword();
    applyAction(g, { t: 'yingziPick', value: 4 });
    attackWithSubstitution(g);
    expect(g.players.A.tacticOnceUsed).toBe(false);
    expect(g.players.A.tacticHeldDie).toEqual({ id: expect.any(String), value: 4 });
  });
});
