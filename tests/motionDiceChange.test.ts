import { describe, it, expect } from 'vitest';
import { createGame } from '../src/core/engine/game';
import { areaDiceChanged, type PrevDice } from '../src/ui/motion';
import type { GameState, Die, DiceKind, PlayerId } from '../src/core/model/types';

const KINDS: DiceKind[] = ['attack', 'defense', 'meditation'];
const PLAYERS: PlayerId[] = ['A', 'B'];

/** 用当前状态构造"上一帧"的骰子快照（模拟 snapshotDice）。 */
const prevOf = (g: GameState): PrevDice => {
  const m: PrevDice = new Map();
  for (const p of PLAYERS)
    for (const k of KINDS)
      for (const d of g.players[p].areas[k])
        m.set(d.id, { rect: { left: 0, top: 0, width: 0, height: 0 }, html: '', owner: p, kind: k, value: d.value });
  return m;
};

const firstDie = (g: GameState): Die => {
  for (const p of PLAYERS) for (const k of KINDS) if (g.players[p].areas[k][0]) return g.players[p].areas[k][0];
  throw new Error('no dice');
};

describe('areaDiceChanged（门槛：id 不变、点数/区变化也要做动画）', () => {
  it('无变化 → false', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    expect(areaDiceChanged(prevOf(g), g)).toBe(false);
  });

  it('点数变了（重掷/改点，id 不变）→ true', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    const prev = prevOf(g);
    const d = firstDie(g);
    d.value = d.value === 6 ? 1 : d.value + 1;
    expect(areaDiceChanged(prev, g)).toBe(true);
  });
});
