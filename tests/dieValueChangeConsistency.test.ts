import { describe, it, expect } from 'vitest';
import { applyAction, createGame, skipInitialReroll } from '../src/core/engine/game';
import { areaDiceChanged, areaDieIds, diceSetChanged, type PrevDice } from '../src/ui/motion';
import type { Artifact, DiceKind, GameState, Pending, PlayerId } from '../src/core/model/types';

const KINDS: DiceKind[] = ['attack', 'defense', 'meditation'];

/** 用当前状态造"上一帧"的骰子快照（模拟 snapshotDice，与 motionDiceChange 同法）。 */
const prevOf = (g: GameState): PrevDice => {
  const m: PrevDice = new Map();
  for (const p of ['A', 'B'] as PlayerId[])
    for (const k of KINDS)
      for (const d of g.players[p].areas[k])
        m.set(d.id, { rect: { left: 0, top: 0, width: 0, height: 0 }, html: '', owner: p, kind: k, value: d.value });
  return m;
};

describe('变点统一：改一颗"已存在"骰的点数必须**保留同一 id**（界面才会走"去中间翻面"，而非"消失+出现"）', () => {
  it('009「高塔铁幕·充能」：对方攻击骰 5→1，同 id、同区 → 触发翻面而不是 id 变化', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(g);
    g.players.A.artifacts = [
      {
        id: '009',
        name: '孤王',
        column: 3,
        skills: [{ side: 'only', kind: 'charge', key: 'guwang.charge' }],
        heldDice: [],
        count: 0,
      } as unknown as Artifact,
    ];
    g.players.B.areas.attack = [{ id: 'bad', value: 5, kind: 'attack' }];
    g.pending = { kind: 'guwangCharge', player: 'A' } as Pending;

    const prev = prevOf(g); // 变更前：bad = 5 点，在攻击区
    applyAction(g, { t: 'guwangCharge', dieId: 'bad' });

    // 值变了
    const die = g.players.B.areas.attack.find((d) => d.id === 'bad');
    expect(die?.value).toBe(1);
    // 仍在同一区、同一 id
    const nextIds = areaDieIds(g);
    expect(diceSetChanged(prev, nextIds)).toBe(false); // 不是"消失 + 出现"
    expect(areaDiceChanged(prev, g)).toBe(true); // 而是"同 id 值变" → 走骰面翻转
  });
});
