import { describe, it, expect } from 'vitest';
import { setupGame } from '../src/core/engine/setup';
import { applyDustRiseToArtifact, canTargetForDustRise } from '../src/core/engine/dustRise';
import { getLegalActions } from '../src/core/engine/game';

describe('dust rise action', () => {
  it('activates a col1 artifact on the chosen side', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    applyDustRiseToArtifact(g, 'A', '001', 'left');
    expect(g.players.A.artifacts.find((a) => a.id === '001')!.activeMarkerSide).toBe('left');
  });

  it('switches an already activated artifact to the other side', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    applyDustRiseToArtifact(g, 'A', '001', 'left');
    applyDustRiseToArtifact(g, 'A', '001');
    expect(g.players.A.artifacts.find((a) => a.id === '001')!.activeMarkerSide).toBe('right');
  });

  it('charges a col3 artifact and activates it at the requirement', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    const mj = g.players.A.artifacts.find((a) => a.id === '003')!; // 充能需求 4
    for (let i = 0; i < 4; i++) applyDustRiseToArtifact(g, 'A', '003');
    expect(mj.chargeLayer).toBe(4);
    expect(mj.activeMarkerSide).toBe('left');
  });

  it('cannot target a fully-charged col3 artifact', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    for (let i = 0; i < 4; i++) applyDustRiseToArtifact(g, 'A', '003');
    const mj = g.players.A.artifacts.find((a) => a.id === '003')!;
    expect(canTargetForDustRise(mj)).toBe(false);
    expect(() => applyDustRiseToArtifact(g, 'A', '003')).toThrow();
  });
});

describe('尘起门槛（统一求值器：支持 010「真实之剑」置换）', () => {
  it('无冥想骰，但有 010 + ≥2 任意骰 → 仍出现普通尘起动作', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', heroA: ['010', '011', '012'] });
    g.phase = 'dustRise';
    g.activePlayer = 'A';
    const A = g.players.A;
    A.areas.meditation = [];
    A.areas.attack.push({ id: 'a1', value: 3, kind: 'attack' }, { id: 'a2', value: 4, kind: 'attack' });
    A.artifacts.find((a) => a.id === '010')!.activeMarkerSide = 'left'; // 010 持续（置换）
    const acts = getLegalActions(g);
    expect(acts.some((a) => a.t === 'dustRise' && !a.free && !a.useSeal)).toBe(true);
  });

  it('无冥想骰且无可置换 → 不出现普通尘起动作', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    g.phase = 'dustRise';
    g.activePlayer = 'A';
    g.players.A.areas.meditation = [];
    const acts = getLegalActions(g);
    expect(acts.some((a) => a.t === 'dustRise' && !a.free && !a.useSeal)).toBe(false);
  });
});
