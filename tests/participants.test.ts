import { describe, it, expect } from 'vitest';
import { createGame } from '../src/core/engine/game';
import {
  alliesOf,
  enemiesOf,
  lifeMaxOf,
  lifeOf,
  nextSeat,
  opponentOf,
  resolveEnemy,
  rosterOf,
  setLife,
  sideOf,
  teamOf,
} from '../src/core/model/participants';

const game = (): any => createGame({ seed: 7, firstPlayer: 'A' });

describe('participants · 1v1 地基', () => {
  it('roster / 阵营 / 敌我 / 环序', () => {
    const g = game();
    expect(rosterOf(g)).toEqual(['A', 'B']);
    expect(sideOf(g, 'A')).toBe('A');
    expect(sideOf(g, 'B')).toBe('B');
    expect(alliesOf(g, 'A')).toEqual([]);
    expect(enemiesOf(g, 'A')).toEqual(['B']);
    expect(opponentOf(g, 'A')).toBe('B');
    expect(resolveEnemy(g, 'A')).toBe('B');
    expect(resolveEnemy(g, 'A', 'B')).toBe('B');
    expect(nextSeat(g, 'A')).toBe('B');
    expect(nextSeat(g, 'B')).toBe('A');
  });

  it('1v1 生命仍以 PlayerState 为准；setLife 同步队伍元数据', () => {
    const g = game();
    const before = g.players.A.life;
    expect(lifeOf(g, 'A')).toBe(before);
    expect(lifeMaxOf(g, 'A')).toBe(g.players.A.lifeMax);
    setLife(g, 'A', before - 7);
    expect(g.players.A.life).toBe(before - 7);
    expect(lifeOf(g, 'A')).toBe(before - 7);
    expect(teamOf(g, 'A')?.life).toBe(before - 7);
  });

  it('显式目标必须是敌人', () => {
    const g = game();
    expect(() => resolveEnemy(g, 'A', 'A')).toThrow();
    expect(() => resolveEnemy(g, 'A', 'B')).not.toThrow();
  });

  it('2v2 形状：队友/两名敌人/共享生命', () => {
    const g = game();
    const A1 = 'A1';
    const A2 = 'A2';
    const B1 = 'B1';
    const B2 = 'B2';
    g.roster = ['A1', 'B1', 'A2', 'B2'];
    g.teamOf = { A1: 'A', A2: 'A', B1: 'B', B2: 'B' };
    g.teams = {
      A: { id: 'A', members: ['A1', 'A2'], life: 40, lifeMax: 60 },
      B: { id: 'B', members: ['B1', 'B2'], life: 30, lifeMax: 60 },
    };
    g.players = {
      A1: { ...g.players.A, id: 'A1' },
      A2: { ...g.players.A, id: 'A2' },
      B1: { ...g.players.B, id: 'B1' },
      B2: { ...g.players.B, id: 'B2' },
    };
    expect(sideOf(g, A1)).toBe('A');
    expect(alliesOf(g, A1)).toEqual([A2]);
    expect(enemiesOf(g, A1)).toEqual([B1, B2]);
    expect(() => opponentOf(g, A1)).toThrow();
    expect(nextSeat(g, 'A1')).toBe('B1');
    expect(nextSeat(g, 'B1')).toBe('A2');
    expect(nextSeat(g, 'A2')).toBe('B2');
    expect(nextSeat(g, 'B2')).toBe('A1');
    expect(resolveEnemy(g, A1, B2)).toBe('B2');
    expect(lifeOf(g, A1)).toBe(40);
    setLife(g, A1, 25);
    expect(g.teams.A.life).toBe(25);
    expect(g.players.A1.life).toBe(25);
    expect(g.players.A2.life).toBe(25);
  });
});
