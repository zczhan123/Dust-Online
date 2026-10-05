// 战术牌 T18「适应」：投掷/获得随机骰时，可指定其中 1 颗的点数（整局 1 次）
import { describe, it, expect } from 'vitest';
import { createGame, applyAction, skipInitialReroll } from '../src/core/engine/game';
import { gainRandomDice } from '../src/core/engine/effects';
import { doReroll } from '../src/core/engine/phases';
import { SeededRng } from '../src/core/rng/rng';
import { TACTIC_POOL } from '../src/core/content/tactics';
import type { Action, GameState, PlayerId } from '../src/core/model/types';

const mk = (): GameState => {
  const g = createGame({
    seed: 1,
    firstPlayer: 'A',
    heroA: ['001', '002', '003'],
    heroB: ['001', '002', '003'],
    tacticA: 'T18',
    tacticB: 'T04',
  });
  skipInitialReroll(g);
  g.phase = 'main';
  g.activePlayer = 'A';
  return g;
};
const pickId = (g: GameState): string =>
  g.pending?.kind === 'shipeiPick' ? g.pending.dieIds[0] : '';

describe('T18「适应」', () => {
  it('重掷 → 挂「适应」待决策（含本次掷出的骰）', () => {
    const g = mk();
    g.players.A.areas.attack = [{ id: 'r1', value: 3, kind: 'attack' }];
    doReroll(g, 'A', ['r1'], new SeededRng(1));
    expect(g.pending?.kind).toBe('shipeiPick');
    expect(pickId(g)).toBe('r1');
  });

  it('发动（按分布落区）：改点后移动到对应区域', () => {
    const g = mk();
    g.players.A.areas.attack = [{ id: 'r1', value: 3, kind: 'attack' }];
    doReroll(g, 'A', ['r1'], new SeededRng(1));
    applyAction(g, { t: 'shipeiPick', dieId: pickId(g), value: 2 }); // 002 分布：2 点＝冥想
    expect(g.players.A.areas.meditation.some((d) => d.value === 2)).toBe(true);
    expect(g.players.A.areas.attack.some((d) => d.id === 'r1')).toBe(false);
    expect(g.players.A.tacticOnceUsed).toBe(true);
  });

  it('发动（固定类型）：只改点、保留区域', () => {
    const g = mk();
    gainRandomDice(g, 'A', 'attack', 1, { rollDie: () => 4 });
    expect(g.pending?.kind).toBe('shipeiPick');
    const id = pickId(g);
    applyAction(g, { t: 'shipeiPick', dieId: id, value: 6 });
    expect(g.players.A.areas.attack.find((d) => d.id === id)?.value).toBe(6);
  });

  it('龙腾万丈（002·右）内联掷的 4 颗随机骰也挂「适应」待决策', () => {
    const g = mk();
    const a002 = g.players.A.artifacts.find((a) => a.id === '002')!;
    a002.activeMarkerSide = 'right';
    a002.armedSide = 'right';
    a002.armedTurn = g.turnIndex;
    g.players.A.areas.meditation = [
      { id: 'm1', value: 1, kind: 'meditation' },
      { id: 'm2', value: 2, kind: 'meditation' },
      { id: 'm3', value: 3, kind: 'meditation' },
    ];
    applyAction(g, {
      t: 'skill',
      artifactId: '002',
      side: 'right',
      params: { costSlots: [{ dieIds: ['m1'] }, { dieIds: ['m2'] }, { dieIds: ['m3'] }] },
    });
    expect(g.pending?.kind).toBe('shipeiPick');
    expect(g.pending && g.pending.kind === 'shipeiPick' ? g.pending.dieIds.length : 0).toBe(4);
  });

  it('不发动：不消耗整局 1 次', () => {
    const g = mk();
    gainRandomDice(g, 'A', 'attack', 1, { rollDie: () => 4 });
    applyAction(g, { t: 'shipeiPick', cancel: true });
    expect(g.players.A.tacticOnceUsed).toBe(false);
    expect(g.pending ?? null).toBeNull();
  });

  it('用过后不再挂', () => {
    const g = mk();
    g.players.A.tacticOnceUsed = true;
    gainRandomDice(g, 'A', 'attack', 1, { rollDie: () => 4 });
    expect(g.pending ?? null).toBeNull();
  });

  it('非法：不在本次骰中 / 点数越界 → 抛错', () => {
    const g = mk();
    gainRandomDice(g, 'A', 'attack', 1, { rollDie: () => 4 });
    expect(() => applyAction(g, { t: 'shipeiPick', dieId: 'nope', value: 3 } as Action)).toThrow();
    expect(() => applyAction(g, { t: 'shipeiPick', dieId: pickId(g), value: 7 } as Action)).toThrow();
    expect(g.pending?.kind).toBe('shipeiPick'); // 状态未变
  });

  it('初始生命修正：自己 +2', () => {
    const base = createGame({ seed: 1, firstPlayer: 'A' });
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T18', tacticB: 'T04' });
    expect(g.players.A.life).toBe(base.players.A.life + 2);
  });

  it('TACTIC_POOL 含 T18', () => {
    expect(TACTIC_POOL).toContain('T18');
  });
});

describe('T18「适应」· 多批随机骰合并（回归）', () => {
  const mkHero = (heroA: [string, string, string]): GameState => {
    const g = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA,
      heroB: ['001', '002', '003'],
      tacticA: 'T18',
      tacticB: 'T04',
    });
    skipInitialReroll(g);
    g.phase = 'main';
    g.activePlayer = 'A';
    return g;
  };
  const activate = (g: GameState, who: PlayerId, id: string, side: 'left' | 'right'): void => {
    const a = g.players[who].artifacts.find((x) => x.id === id)!;
    a.activeMarkerSide = side;
    a.armedSide = side;
    a.armedTurn = g.turnIndex;
  };
  const shipeiIds = (g: GameState): string[] => (g.pending?.kind === 'shipeiPick' ? g.pending.dieIds : []);

  it('潜行（005）：同次获得的 2 防御 + 1 冥想 全部可选；可在冥想骰上发动（改点、仍留冥想区）', () => {
    const g = mkHero(['001', '005', '003']); // 第二列 = 005 影掠（右「潜行」）
    g.players.A.areas.attack = [
      { id: 'at1', value: 1, kind: 'attack' },
      { id: 'at2', value: 2, kind: 'attack' },
    ];
    g.players.A.areas.defense = [];
    g.players.A.areas.meditation = [];
    activate(g, 'A', '005', 'right');
    applyAction(g, {
      t: 'skill',
      artifactId: '005',
      side: 'right',
      params: { costSlots: [{ dieIds: ['at1'] }, { dieIds: ['at2'] }] },
    });
    expect(g.pending?.kind).toBe('shipeiPick');
    const ids = shipeiIds(g);
    expect(ids).toHaveLength(3); // 2 防御 + 1 冥想（修复前只有 2 颗防御）
    const med = g.players.A.areas.meditation.find((d) => ids.includes(d.id));
    expect(med).toBeTruthy(); // 冥想骰进入候选（修复前不在）
    applyAction(g, { t: 'shipeiPick', dieId: med!.id, value: 6 });
    expect(g.players.A.areas.meditation.find((d) => d.id === med!.id)?.value).toBe(6);
    expect(g.players.A.tacticOnceUsed).toBe(true);
  });

  it('通用：同一事件分两批获得随机骰 → 候选累积（不被丢弃）', () => {
    const g = mk();
    gainRandomDice(g, 'A', 'defense', 1, { rollDie: () => 3 });
    gainRandomDice(g, 'A', 'meditation', 1, { rollDie: () => 5 });
    expect(g.pending?.kind).toBe('shipeiPick');
    expect(shipeiIds(g)).toHaveLength(2);
  });

  it('待决策在队列中（g.pending 被别的待决策占用）时同样并入', () => {
    const g = mk();
    // 占位待决策：阻止 pumpPending 把 shipeiPick 弹出（模拟 026 陷阵：解决自身待决策期间再获得两类骰）
    g.pending = { kind: 'tacticGuess', player: 'A' };
    gainRandomDice(g, 'A', 'defense', 1, { rollDie: () => 3 });
    gainRandomDice(g, 'A', 'meditation', 1, { rollDie: () => 5 });
    const q = g.pendingQueue.find((x) => x.kind === 'shipeiPick');
    expect(q).toBeTruthy();
    expect(q && q.kind === 'shipeiPick' ? q.dieIds.length : 0).toBe(2);
  });
});
