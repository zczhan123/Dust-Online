import { describe, it, expect } from 'vitest';
import { applyAction, createGame, skipInitialReroll } from '../src/core/engine/game';
import { fxReset, fxTake } from '../src/core/engine/fx';
import type { Artifact, GameState } from '../src/core/model/types';

/** A 持 001（裁雨流·右，触发）+ 一颗 4 点攻击骰；B 空闲。 */
const setup = (): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A' });
  skipInitialReroll(g);
  g.activePlayer = 'A';
  g.phase = 'main';
  g.players.A.artifacts = [
    {
      id: '001',
      name: '影切',
      column: 1,
      skills: [{ side: 'right', kind: 'trigger', key: 'yuqie.caiyuliu' }],
      activeMarkerSide: 'right',
      heldDice: [],
      count: 0,
    } as unknown as Artifact,
  ];
  g.players.A.areas.attack = [{ id: 'atk1', value: 4, kind: 'attack' }];
  g.players.A.areas.defense = [];
  g.players.A.areas.meditation = [];
  return g;
};

describe('001「裁雨流」：命中后攻击骰先停在中间（holdAttackDie）+ 进入待决策', () => {
  it('物理攻击命中 → 发一条 holdAttackDie（带攻击骰 id），并挂 caiyuliu 待决策', () => {
    const g = setup();
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['atk1'] }] }); // A 攻击
    fxReset();
    applyAction(g, { t: 'block' }); // B 不抵挡 → 命中造成伤害
    const evs = fxTake();
    expect(evs.some((e) => e.kind === 'holdAttackDie' && e.player === 'A' && e.dieId === 'atk1')).toBe(true);
    expect(g.pending?.kind).toBe('caiyuliu');
  });
});
