import { describe, it, expect } from 'vitest';
import { SeededRng } from '../src/core/rng/rng';

describe('SeededRng', () => {
  it('is deterministic for the same seed', () => {
    const a = new SeededRng(42);
    const b = new SeededRng(42);
    const seqA = [a.int(6), a.int(6), a.int(6), a.int(6)];
    const seqB = [b.int(6), b.int(6), b.int(6), b.int(6)];
    expect(seqA).toEqual(seqB);
  });

  it('returns integers within range', () => {
    const r = new SeededRng(7);
    for (let i = 0; i < 100; i++) {
      const v = r.int(6);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
    }
  });

  it('rollDie returns 1..6', () => {
    const r = new SeededRng(1);
    for (let i = 0; i < 50; i++) {
      const v = r.rollDie();
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
    }
  });

  it('different seeds diverge', () => {
    const a = new SeededRng(1);
    const b = new SeededRng(2);
    const seqA = Array.from({ length: 10 }, () => a.int(1000));
    const seqB = Array.from({ length: 10 }, () => b.int(1000));
    expect(seqA).not.toEqual(seqB);
  });
});
