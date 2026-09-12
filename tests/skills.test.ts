import { describe, it, expect } from 'vitest';
import { createGame, applyAction } from '../src/core/engine/game';
import { totalDice } from '../src/core/engine/derive';

describe('basic activate skills', () => {
  it('淬炼 consumes an attack die and increments 不祥 count (cap 3)', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['004', '002', '003'] });
    applyAction(g, { t: 'advance' }); // -> main
    const buxiang = g.players.A.artifacts.find((a) => a.id === '004')!;
    buxiang.activeMarkerSide = 'left';
    g.players.A.areas.attack.push({ id: 'x', value: 3, kind: 'attack' });
    applyAction(g, { t: 'skill', artifactId: '004', side: 'left', params: { attackDieId: 'x' } });
    expect(buxiang.count).toBe(1);
    expect(g.players.A.areas.attack.some((d) => d.id === 'x')).toBe(false);
  });

  it('龙腾万丈 consumes 3 meditation dice, gains 4, moves 2 to attack and adds +1 damage', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    applyAction(g, { t: 'advance' });
    const youlong = g.players.A.artifacts.find((a) => a.id === '002')!;
    youlong.activeMarkerSide = 'right';
    while (g.players.A.areas.meditation.length < 3) {
      g.players.A.areas.meditation.push({ id: `m${g.players.A.areas.meditation.length}`, value: 2, kind: 'meditation' });
    }
    const medIds = g.players.A.areas.meditation.slice(0, 3).map((d) => d.id);
    const before = totalDice(g.players.A);
    const atkBefore = g.players.A.areas.attack.length;
    applyAction(g, { t: 'skill', artifactId: '002', side: 'right', params: { meditationDieIds: medIds } });
    expect(totalDice(g.players.A)).toBe(before - 3 + 4);
    expect(g.players.A.areas.attack.length).toBe(atkBefore + 2);
    expect(g.players.A.buffs.some((b) => b.attr === 'attackDamage' && b.add === 1)).toBe(true);
  });

  it('潜行 consumes 2 attack dice and gains 2 defense + 1 meditation', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    g.activePlayer = 'B';
    g.phase = 'main';
    const a = g.players.B.artifacts.find((x) => x.id === '005')!;
    a.activeMarkerSide = 'right';
    g.players.B.areas.attack.push({ id: 'p1', value: 3, kind: 'attack' }, { id: 'p2', value: 4, kind: 'attack' });
    const defBefore = g.players.B.areas.defense.length;
    const medBefore = g.players.B.areas.meditation.length;
    applyAction(g, { t: 'skill', artifactId: '005', side: 'right', params: { attackDieIds: ['p1', 'p2'] } });
    expect(g.players.B.areas.defense.length).toBe(defBefore + 2);
    expect(g.players.B.areas.meditation.length).toBe(medBefore + 1);
  });

  it('rejects activating a skill that is not active', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    applyAction(g, { t: 'advance' });
    g.players.A.areas.attack.push({ id: 'x', value: 3, kind: 'attack' });
    expect(() => applyAction(g, { t: 'skill', artifactId: '004', side: 'left', params: { attackDieId: 'x' } })).toThrow();
  });

  it('rejects using the same activate skill twice in one turn', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['004', '002', '003'] });
    applyAction(g, { t: 'advance' });
    const buxiang = g.players.A.artifacts.find((a) => a.id === '004')!;
    buxiang.activeMarkerSide = 'left';
    g.players.A.areas.attack.push({ id: 'x1', value: 3, kind: 'attack' }, { id: 'x2', value: 4, kind: 'attack' });
    applyAction(g, { t: 'skill', artifactId: '004', side: 'left', params: { attackDieId: 'x1' } });
    expect(() => applyAction(g, { t: 'skill', artifactId: '004', side: 'left', params: { attackDieId: 'x2' } })).toThrow();
  });
});

import { getLegalActions } from '../src/core/engine/game';

describe('charge effects', () => {
  it('明镜 charge grants a free extra dust rise (not counting the 1/round limit)', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    g.players.A.areas.meditation.push({ id: 'm0', value: 2, kind: 'meditation' });
    applyAction(g, { t: 'dustRise', artifactId: '003' });
    expect(g.players.A.artifacts.find((a) => a.id === '003')!.chargeLayer).toBe(1);
    expect(g.freeDustRise).toBe(1);
    expect(getLegalActions(g).some((a) => a.t === 'dustRise')).toBe(true);
    // 用掉这次额外尘起（再次充能 → 又获得 1 次额外）
    g.players.A.areas.meditation.push({ id: 'm1', value: 3, kind: 'meditation' });
    applyAction(g, { t: 'dustRise', artifactId: '003' });
    expect(g.players.A.artifacts.find((a) => a.id === '003')!.chargeLayer).toBe(2);
    expect(g.freeDustRise).toBe(1);
  });

  it('完杀 charge grants an attack die equal to the charge layer', () => {
    const g = createGame({ seed: 1, firstPlayer: 'B' }); // B 持 006
    g.players.B.areas.meditation.push({ id: 'm0', value: 2, kind: 'meditation' });
    const before = g.players.B.areas.attack.length;
    applyAction(g, { t: 'dustRise', artifactId: '006' });
    const wansha = g.players.B.artifacts.find((a) => a.id === '006')!;
    expect(wansha.chargeLayer).toBe(1);
    expect(g.players.B.areas.attack.length).toBe(before + 1);
    expect(g.players.B.areas.attack[g.players.B.areas.attack.length - 1]!.value).toBe(1);
  });

  it('charging a col3 artifact via dust seal also triggers its charge effect', () => {
    const g = createGame({ seed: 1, firstPlayer: 'B' });
    g.players.B.hasDustSeal = true;
    const before = g.players.B.areas.attack.length;
    applyAction(g, { t: 'dustRise', artifactId: '006', useSeal: true });
    expect(g.players.B.artifacts.find((a) => a.id === '006')!.chargeLayer).toBe(1);
    expect(g.players.B.areas.attack.length).toBe(before + 1);
  });
});
