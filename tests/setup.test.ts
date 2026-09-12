import { describe, it, expect } from 'vitest';
import { setupGame } from '../src/core/engine/setup';
import { totalDice } from '../src/core/engine/derive';

describe('setup', () => {
  it('each player gets dice equal to their will, placed by distribution', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    expect(totalDice(g.players.A)).toBe(7);
    expect(totalDice(g.players.B)).toBe(8);
  });

  it('dice land in the area dictated by column-2 distribution', () => {
    const g = setupGame({ seed: 99, firstPlayer: 'A' });
    const dist = g.players.A.artifacts.find((a) => a.column === 2)!.distribution!;
    for (const d of g.players.A.areas.attack) expect(dist.attack).toContain(d.value);
    for (const d of g.players.A.areas.defense) expect(dist.defense).toContain(d.value);
    for (const d of g.players.A.areas.meditation) expect(dist.meditation).toContain(d.value);
  });

  it('后手 gets the dust seal', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    expect(g.players.B.hasDustSeal).toBe(true);
    expect(g.players.A.hasDustSeal).toBe(false);
  });

  it('life equals column-3 life', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    expect(g.players.A.life).toBe(50);
    expect(g.players.A.lifeMax).toBe(50);
  });

  it('is deterministic for a seed', () => {
    const g1 = setupGame({ seed: 5, firstPlayer: 'A' });
    const g2 = setupGame({ seed: 5, firstPlayer: 'A' });
    const strip = (g: typeof g1) => ({
      A: { attack: g.players.A.areas.attack.map((d) => d.value) },
      B: { attack: g.players.B.areas.attack.map((d) => d.value) },
    });
    expect(strip(g1)).toEqual(strip(g2));
  });
});
