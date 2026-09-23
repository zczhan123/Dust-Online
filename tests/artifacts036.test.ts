import { describe, it, expect } from 'vitest';
import { createGame, applyAction, skipInitialReroll, getLegalActions } from '../src/core/engine/game';
import { SKILL_HANDLERS } from '../src/core/engine/skills';
import { SeededRng } from '../src/core/rng/rng';
import type { GameState, PlayerId } from '../src/core/model/types';

/** A 持 001/002/036，B 持 004/005/006 */
const g036 = (): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '036'], heroB: ['004', '005', '006'] });
  skipInitialReroll(g);
  return g;
};
const art = (g: GameState, who: PlayerId, id: string) => g.players[who].artifacts.find((a) => a.id === id)!;
const clear = (g: GameState, who: PlayerId): void => {
  g.players[who].areas.attack = [];
  g.players[who].areas.defense = [];
  g.players[who].areas.meditation = [];
};
const runSkill = (g: GameState, who: PlayerId, id: string, key: string, params: Record<string, unknown> = {}): void => {
  SKILL_HANDLERS[key].run({
    g,
    player: who,
    artifact: art(g, who, id),
    rng: new SeededRng(1),
    params,
    endMainPhase: () => {},
    reportConsumed: () => {},
  });
};
const total = (g: GameState, who: PlayerId): number =>
  g.players[who].areas.attack.length + g.players[who].areas.defense.length + g.players[who].areas.meditation.length;

describe('036 无相（万象俱灭）', () => {
  it('充能（必执行）：弃任意玩家 1 颗能力骰 → 该玩家回复 3 点生命', () => {
    const g = g036();
    clear(g, 'A');
    clear(g, 'B');
    g.players.B.areas.attack = [{ id: 'b1', value: 2, kind: 'attack' }];
    g.players.B.life = 40;
    runSkill(g, 'A', '036', 'wuxiang.charge', { owner: 'opponent', dieId: 'b1' });
    expect(total(g, 'B')).toBe(0);
    expect(g.players.B.life).toBe(43);
  });

  it('必杀：条件具备时提供；保留 1–6 各 1 个，弃其余全部，真伤 = 被弃不同点数之和', () => {
    const g = g036();
    g.phase = 'main';
    g.activePlayer = 'A';
    const a = art(g, 'A', '036');
    a.activeMarkerSide = 'left';
    clear(g, 'A');
    clear(g, 'B');
    // A: 1–6 各 1（6 颗）
    g.players.A.areas.meditation = [
      { id: 'a1', value: 1, kind: 'meditation' },
      { id: 'a2', value: 2, kind: 'meditation' },
      { id: 'a3', value: 3, kind: 'meditation' },
    ];
    g.players.A.areas.defense = [{ id: 'a4', value: 4, kind: 'defense' }];
    g.players.A.areas.attack = [
      { id: 'a5', value: 5, kind: 'attack' },
      { id: 'a6', value: 6, kind: 'attack' },
    ];
    // B: 2,3,6（将被弃）
    g.players.B.areas.attack = [{ id: 'b2', value: 2, kind: 'attack' }];
    g.players.B.areas.defense = [{ id: 'b3', value: 3, kind: 'defense' }];
    g.players.B.areas.meditation = [{ id: 'b6', value: 6, kind: 'meditation' }];
    const lifeB = g.players.B.life;
    // 条件具备 → 出现必杀动作
    const skillAct = getLegalActions(g).find((x) => x.t === 'skill' && x.artifactId === '036');
    expect(skillAct).toBeTruthy();
    applyAction(g, skillAct!);
    // A 保留 1–6 各 1（不变）；B 全部被弃
    expect(total(g, 'A')).toBe(6);
    expect(total(g, 'B')).toBe(0);
    // 伤害 = 被弃的不同点数之和 = 2+3+6 = 11
    expect(g.players.B.life).toBe(lifeB - 11);
  });

  it('必杀：条件不满足（缺某点数）时不出现在合法动作里', () => {
    const g = g036();
    g.phase = 'main';
    g.activePlayer = 'A';
    const a = art(g, 'A', '036');
    a.activeMarkerSide = 'left';
    clear(g, 'A');
    clear(g, 'B');
    // 只有 1–5，缺 6
    g.players.A.areas.attack = [1, 2, 3, 4, 5].map((v) => ({ id: `x${v}`, value: v, kind: 'attack' as const }));
    const offered = getLegalActions(g).some((x) => x.t === 'skill' && x.artifactId === '036');
    expect(offered).toBe(false);
  });
});
