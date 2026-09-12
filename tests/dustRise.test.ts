import { describe, it, expect } from 'vitest';
import { setupGame } from '../src/core/engine/setup';
import { applyDustRiseToArtifact, canTargetForDustRise } from '../src/core/engine/dustRise';

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
