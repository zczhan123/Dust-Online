import { describe, it, expect } from 'vitest';
import { makeArtifact } from '../src/core/content/artifacts';
import { baseSpeed, baseWill, emptyDistribution, effectiveSpeed, effectiveWill } from '../src/core/engine/derive';
import type { PlayerState } from '../src/core/model/types';

function player(ids: string[]): PlayerState {
  return {
    id: 'A',
    areas: { attack: [], defense: [], meditation: [] },
    artifacts: ids.map(makeArtifact),
    life: 50, lifeMax: 50, markers: 0, hasDustSeal: false, buffs: [],
  };
}

describe('attribute derivation (single source per column)', () => {
  it('speed/will come from column 1', () => {
    const p = player(['001', '002', '003']);
    expect(baseSpeed(p)).toBe(4);
    expect(baseWill(p)).toBe(7);
  });
  it('影 side uses 不祥', () => {
    const p = player(['004', '005', '006']);
    expect(baseSpeed(p)).toBe(4);
    expect(baseWill(p)).toBe(8);
  });
  it('distribution comes from column 2', () => {
    const p = player(['001', '002', '003']);
    expect(emptyDistribution(p)?.attack).toEqual([3, 4]);
  });
  it('same-attribute buffs take max, not sum', () => {
    const p = player(['001', '002', '003']);
    p.buffs.push({ attr: 'speed', add: 1, duration: 'thisTurn' });
    p.buffs.push({ attr: 'speed', add: 2, duration: 'thisTurn' });
    expect(effectiveSpeed(p)).toBe(6); // 4 + max(1,2)
  });
  it('effectiveWill applies max buff', () => {
    const p = player(['001', '002', '003']);
    p.buffs.push({ attr: 'will', add: 3, duration: 'permanent' });
    expect(effectiveWill(p)).toBe(10);
  });
});
