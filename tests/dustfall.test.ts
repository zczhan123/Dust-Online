import { describe, it, expect } from 'vitest';
import { setupGame } from '../src/core/engine/setup';
import { incrementDustfall } from '../src/core/engine/dustfall';

describe('dustfall', () => {
  it('increments the shared counter', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    incrementDustfall(g);
    expect(g.dustfall).toBe(1);
  });

  it('ends the game at 10 with the higher life winning', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    g.players.A.life = 40;
    g.players.B.life = 30;
    g.dustfall = 9;
    incrementDustfall(g);
    expect(g.phase).toBe('gameOver');
    expect(g.winner).toBe('A');
  });

  it('breaks a life tie with the current turn player', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'B' });
    g.players.A.life = 20;
    g.players.B.life = 20;
    g.dustfall = 9;
    incrementDustfall(g);
    expect(g.phase).toBe('gameOver');
    expect(g.winner).toBe('B');
  });
});
