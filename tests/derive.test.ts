import { describe, it, expect } from 'vitest';
import { makeArtifact } from '../src/core/content/artifacts';
import { baseSpeed, baseWill, emptyDistribution, effectiveSpeed, effectiveWill } from '../src/core/engine/derive';
import type { PlayerState } from '../src/core/model/types';

function player(ids: string[]): PlayerState {
  return {
    id: 'A',
    areas: { attack: [], defense: [], meditation: [] },
    artifacts: ids.map(makeArtifact),
    life: 50, lifeMax: 50, markers: 0, hasDustSeal: false,
    damagedThisTurn: false,
    attackHalvedNextTurn: false, dealtDamageThisTurn: false, noDamageLastTurn: false, lifeTens: 0, tiandanGainedThisTurn: 0, buffs: [],
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

import { rerollAllowance } from '../src/core/engine/derive';

describe('continuous skills', () => {
  it('龙游万象 grants +1 speed when 游龙 is activated left', () => {
    const p = player(['001', '002', '003']);
    expect(effectiveSpeed(p)).toBe(4);
    p.artifacts.find((a) => a.id === '002')!.activeMarkerSide = 'left';
    expect(effectiveSpeed(p)).toBe(5);
    expect(rerollAllowance(p)).toBe(2);
  });
  it('default reroll allowance is 1', () => {
    const p = player(['001', '002', '003']);
    expect(rerollAllowance(p)).toBe(1);
  });
  it('龙游万象 speed +1 takes max with speed buffs', () => {
    const p = player(['001', '002', '003']);
    p.artifacts.find((a) => a.id === '002')!.activeMarkerSide = 'left';
    p.buffs.push({ attr: 'speed', add: 3, duration: 'thisTurn' });
    expect(effectiveSpeed(p)).toBe(7); // 4 + max(3,1)
  });
});

describe('dynamic continuous skill attributes (007-012)', () => {
  it('008 战车 grants +1 will when active', () => {
    const p = player(['001', '008', '003']);
    expect(effectiveWill(p)).toBe(7);
    p.artifacts.find((a) => a.id === '008')!.activeMarkerSide = 'left';
    expect(effectiveWill(p)).toBe(8); // 7 + max(0,1)
  });
  it('008 战车 will bonus takes max with will buffs', () => {
    const p = player(['001', '008', '003']);
    p.artifacts.find((a) => a.id === '008')!.activeMarkerSide = 'left';
    p.buffs.push({ attr: 'will', add: 3, duration: 'thisTurn' });
    expect(effectiveWill(p)).toBe(10); // 7 + max(3,1)
  });
  it('012 梦醒时分 grants speed +X where X = meditation count (2 dice → +2)', () => {
    const p = player(['001', '002', '012']);
    expect(effectiveSpeed(p)).toBe(4);
    p.artifacts.find((a) => a.id === '012')!.activeMarkerSide = 'left';
    p.areas.meditation.push({ id: 'm1', value: 3, kind: 'meditation' });
    p.areas.meditation.push({ id: 'm2', value: 5, kind: 'meditation' });
    expect(effectiveSpeed(p)).toBe(6); // 4 + min(3,2)
  });
  it('012 梦醒时分 caps speed bonus at +3 with 5 meditation dice', () => {
    const p = player(['001', '002', '012']);
    p.artifacts.find((a) => a.id === '012')!.activeMarkerSide = 'left';
    for (let i = 0; i < 5; i++) p.areas.meditation.push({ id: `m${i}`, value: 3, kind: 'meditation' });
    expect(effectiveSpeed(p)).toBe(7); // 4 + min(3,5)
  });
  it('012 梦醒时分 also grants +1 will when active', () => {
    const p = player(['001', '002', '012']);
    p.artifacts.find((a) => a.id === '012')!.activeMarkerSide = 'left';
    expect(effectiveWill(p)).toBe(8); // baseWill 7 (from 001) + 1
  });
});
