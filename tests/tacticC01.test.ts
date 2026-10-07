import { describe, it, expect } from 'vitest';
import { applyAction, createGame, skipInitialReroll } from '../src/core/engine/game';
import type { Artifact, DiceKind, GameState } from '../src/core/model/types';

const KINDS: DiceKind[] = ['attack', 'defense', 'meditation'];

/** A 持 C01（极之境·裁雨流·右）+ 一件第二列（提供分布）+ 一颗 4 点攻击骰。 */
const setup = (): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A' });
  skipInitialReroll(g);
  g.activePlayer = 'A';
  g.phase = 'main';
  g.players.A.artifacts = [
    {
      id: 'C01',
      name: '雨切',
      column: 1,
      skills: [{ side: 'right', kind: 'trigger', key: 'c01.caiyuliu' }],
      activeMarkerSide: 'right',
      heldDice: [],
      count: 0,
    } as unknown as Artifact,
    {
      id: '005',
      name: '影刃',
      column: 2,
      distribution: { defense: [3], attack: [1, 2, 6], meditation: [4, 5] },
      skills: [],
      heldDice: [],
      count: 0,
    } as unknown as Artifact,
  ];
  g.players.A.areas.attack = [{ id: 'atk1', value: 4, kind: 'attack' }];
  g.players.A.areas.defense = [];
  g.players.A.areas.meditation = [];
  return g;
};

describe('C01「极之境·裁雨流」：发动后**复用攻击骰 id**（界面才能"中间重掷翻面 → 飞回区域"）', () => {
  it('accept → 该骰落进某区域，且 id 仍是攻击骰 id（atk1）', () => {
    const g = setup();
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['atk1'] }] });
    applyAction(g, { t: 'block' }); // 命中造成伤害 → c01Caiyuliu 待决策
    expect(g.pending?.kind).toBe('c01Caiyuliu');

    applyAction(g, { t: 'c01Caiyuliu', accept: true });
    const landed = KINDS.some((k) => g.players.A.areas[k].some((d) => d.id === 'atk1'));
    expect(landed).toBe(true);
  });
});
