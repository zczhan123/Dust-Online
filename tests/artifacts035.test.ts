import { describe, it, expect } from 'vitest';
import { createGame, applyAction, skipInitialReroll } from '../src/core/engine/game';
import { effectiveSpeed, effectiveWill } from '../src/core/engine/derive';
import { areaOf } from '../src/core/model/dice';
import type { DiceKind, GameState, PlayerId } from '../src/core/model/types';

/** A 持 035（第 2 列），B 持 004/005/006 */
const g035 = (heroA: [string, string, string] = ['001', '035', '003']): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA, heroB: ['004', '005', '006'] });
  skipInitialReroll(g);
  return g;
};
const art = (g: GameState, who: PlayerId, id: string) => g.players[who].artifacts.find((a) => a.id === id)!;
const arm = (g: GameState, who: PlayerId, id: string, side: 'left' | 'right'): void => {
  const a = art(g, who, id);
  a.activeMarkerSide = side;
  a.armedSide = side;
  a.armedTurn = g.turnIndex;
};
const toMain = (g: GameState): void => {
  let guard = 0;
  while (g.phase !== 'main' && g.phase !== 'gameOver' && guard++ < 12) applyAction(g, { t: 'advance' });
};
const clear = (g: GameState, who: PlayerId): void => {
  g.players[who].areas.attack = [];
  g.players[who].areas.defense = [];
  g.players[who].areas.meditation = [];
};
const findAnywhere = (g: GameState, who: PlayerId, id: string) => {
  for (const k of ['attack', 'defense', 'meditation'] as DiceKind[]) {
    const d = g.players[who].areas[k].find((x) => x.id === id);
    if (d) return d;
  }
  return undefined;
};

describe('035 千劫（万丈明光 / 超度）', () => {
  it('万丈明光（持续）：速度 +3、意志 +2', () => {
    const g = g035();
    toMain(g);
    const s0 = effectiveSpeed(g.players.A);
    const w0 = effectiveWill(g.players.A);
    arm(g, 'A', '035', 'left');
    expect(effectiveSpeed(g.players.A)).toBe(s0 + 3);
    expect(effectiveWill(g.players.A)).toBe(w0 + 2);
  });

  it('万丈明光：进入主要阶段时弹出「弃置 2 个能力骰」待决策', () => {
    const g = g035();
    arm(g, 'A', '035', 'left');
    clear(g, 'A');
    g.players.A.areas.meditation = [
      { id: 'm1', value: 1, kind: 'meditation' },
      { id: 'm2', value: 2, kind: 'meditation' },
      { id: 'm3', value: 3, kind: 'meditation' },
    ];
    g.phase = 'dustRise';
    g.dustRiseActed = true;
    applyAction(g, { t: 'advance' }); // 进入主要阶段
    expect(g.phase).toBe('main');
    expect(g.pending?.kind).toBe('wanzhangDiscard');
    applyAction(g, { t: 'wanzhangDiscard', dieIds: ['m1', 'm2'] });
    expect(g.players.A.areas.meditation.map((d) => d.id)).toEqual(['m3']);
  });

  it('超度：消耗 2 个同点冥想骰 → 对对方 5 真伤 → 重掷所选区域并按分布落区', () => {
    const g = g035();
    toMain(g);
    arm(g, 'A', '035', 'right');
    clear(g, 'A');
    clear(g, 'B');
    g.players.A.areas.meditation = [
      { id: 'k1', value: 3, kind: 'meditation' },
      { id: 'k2', value: 3, kind: 'meditation' },
    ];
    g.players.B.areas.attack = [{ id: 'ba', value: 2, kind: 'attack' }];
    const lifeB = g.players.B.life;
    applyAction(g, {
      t: 'skill',
      artifactId: '035',
      side: 'right',
      params: {
        costSlots: [{ dieIds: ['k1'] }, { dieIds: ['k2'] }],
        targetOwner: 'opponent',
        targetKind: 'attack',
      },
    });
    expect(g.players.A.areas.meditation.length).toBe(0);
    expect(g.players.B.life).toBe(lifeB - 5);
    // 被重掷的骰按新点数落在对应区域
    const moved = findAnywhere(g, 'B', 'ba');
    const distB = g.players.B.artifacts.find((a) => a.column === 2)!.distribution!;
    expect(moved).toBeDefined();
    expect(moved!.kind).toBe(areaOf(moved!.value, distB));
  });

  it('超度：两颗冥想骰点数不同 → 抛错且不消耗（非法不改状态）', () => {
    const g = g035();
    toMain(g);
    arm(g, 'A', '035', 'right');
    clear(g, 'A');
    g.players.A.areas.meditation = [
      { id: 'k1', value: 3, kind: 'meditation' },
      { id: 'k2', value: 4, kind: 'meditation' },
    ];
    expect(() =>
      applyAction(g, {
        t: 'skill',
        artifactId: '035',
        side: 'right',
        params: {
          costSlots: [{ dieIds: ['k1'] }, { dieIds: ['k2'] }],
          targetOwner: 'opponent',
          targetKind: 'attack',
        },
      }),
    ).toThrow();
    expect(g.players.A.areas.meditation.length).toBe(2);
  });

  it('§19-①：真实之剑激活时，可用 4 颗任意骰（2 组置换，均为 5 点）支付「超度」', () => {
    const g = g035(['010', '035', '003']);
    toMain(g);
    arm(g, 'A', '010', 'left'); // 真实之剑
    arm(g, 'A', '035', 'right');
    clear(g, 'A');
    clear(g, 'B');
    g.players.A.areas.attack = [
      { id: 'd1', value: 1, kind: 'attack' },
      { id: 'd2', value: 2, kind: 'attack' },
      { id: 'd3', value: 4, kind: 'attack' },
      { id: 'd4', value: 6, kind: 'attack' },
    ];
    const lifeB = g.players.B.life;
    applyAction(g, {
      t: 'skill',
      artifactId: '035',
      side: 'right',
      params: {
        costSlots: [{ dieIds: ['d1', 'd2'] }, { dieIds: ['d3', 'd4'] }],
        targetOwner: 'opponent',
        targetKind: 'defense',
      },
    });
    expect(g.players.A.areas.attack.length).toBe(0);
    expect(g.players.B.life).toBe(lifeB - 5);
  });
});
