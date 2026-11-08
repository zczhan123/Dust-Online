import { describe, it, expect } from 'vitest';
import { createTwoVTwoGame } from '../src/core/engine/game';
import { resolvePolicyTarget, targetCandidates } from '../src/core/engine/targeting';
import type { TwoVTwoSetup } from '../src/core/model/twoVTwo';

const setup = (): TwoVTwoSetup => ({
  seats: {
    A1: ['001', '002', '003'],
    A2: ['004', '005', '006'],
    B1: ['007', '008', '009'],
    B2: ['010', '011', '012'],
  },
  firstTeam: 'A',
  seed: 7,
});

describe('2v2 目标策略', () => {
  it('anySeat = 自己 + 队友 + 两名敌人', () => {
    const g = createTwoVTwoGame(setup());
    expect(targetCandidates(g, 'A1', 'anySeat')).toEqual(['A1', 'A2', 'B1', 'B2']);
    expect(resolvePolicyTarget(g, 'A1', 'anySeat', 'A2')).toBe('A2');
    expect(resolvePolicyTarget(g, 'A1', 'anySeat', 'A1')).toBe('A1');
  });

  it('selfOrEnemy / enemyOnly 不含队友', () => {
    const g = createTwoVTwoGame(setup());
    expect(targetCandidates(g, 'A1', 'selfOrEnemy')).toEqual(['A1', 'B1', 'B2']);
    expect(targetCandidates(g, 'A1', 'enemyOnly')).toEqual(['B1', 'B2']);
    expect(() => resolvePolicyTarget(g, 'A1', 'selfOrEnemy', 'A2')).toThrow();
    expect(() => resolvePolicyTarget(g, 'A1', 'enemyOnly', 'A2')).toThrow();
  });

  it('强制目标必须显式给出；无目标策略拒绝解析', () => {
    const g = createTwoVTwoGame(setup());
    expect(resolvePolicyTarget(g, 'A1', 'forced', 'B2')).toBe('B2');
    expect(() => resolvePolicyTarget(g, 'A1', 'forced')).toThrow();
    expect(() => resolvePolicyTarget(g, 'A1', 'none')).toThrow();
  });
});
