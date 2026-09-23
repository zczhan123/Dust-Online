import { describe, it, expect } from 'vitest';
import { createGame, applyAction, skipInitialReroll } from '../src/core/engine/game';
import type { GameState, PlayerId } from '../src/core/model/types';

/** A 持 035（第 2 列）+ 027（第 3 列），B 持 004/005/006 */
const toMain = (g: GameState): void => {
  let guard = 0;
  while (g.phase !== 'main' && g.phase !== 'gameOver' && guard++ < 12) applyAction(g, { t: 'advance' });
};
const art = (g: GameState, who: PlayerId, id: string) => g.players[who].artifacts.find((a) => a.id === id)!;
const clear = (g: GameState, who: PlayerId): void => {
  g.players[who].areas.attack = [];
  g.players[who].areas.defense = [];
  g.players[who].areas.meditation = [];
};

describe('035 超度 × 027 凛冽之音（重掷联动，FAQ 35.2.1）', () => {
  it('重掷“谁的区域”，谁受 027 真伤；持有者不受', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '035', '027'], heroB: ['004', '005', '006'] });
    skipInitialReroll(g);
    toMain(g);
    art(g, 'A', '035').activeMarkerSide = 'right';
    g.rerollPunish.A = true; // 视为已充能「凛冽之音」（027）
    clear(g, 'A');
    clear(g, 'B');
    g.players.A.areas.meditation = [
      { id: 'k1', value: 5, kind: 'meditation' },
      { id: 'k2', value: 5, kind: 'meditation' },
    ];
    g.players.B.areas.attack = [
      { id: 'b1', value: 1, kind: 'attack' },
      { id: 'b2', value: 2, kind: 'attack' },
    ];
    const lifeB = g.players.B.life;
    const lifeA = g.players.A.life;
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
    expect(g.players.B.life).toBe(lifeB - 5 - 2); // 超度 5 点 + 凛冽之音（重掷 2 颗）
    expect(g.players.A.life).toBe(lifeA);
  });
});
