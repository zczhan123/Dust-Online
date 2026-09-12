import { describe, it, expect } from 'vitest';
import { setupGame } from '../src/core/engine/setup';
import { doAttack, resolveBlock, dealTrueDamage } from '../src/core/engine/combat';
import { totalDice } from '../src/core/engine/derive';

describe('combat', () => {
  it('attack creates a pending attack with the die value and consumes the die', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    const die = g.players.A.areas.attack[0];
    const before = totalDice(g.players.A);
    doAttack(g, 'A', die.id);
    expect(g.pendingAttack).toEqual({ attacker: 'A', value: die.value, unblockable: false });
    expect(totalDice(g.players.A)).toBe(before - 1);
  });

  it('blocking prevents damage and consumes the defense die', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    const atk = g.players.A.areas.attack[0];
    doAttack(g, 'A', atk.id);
    const def = g.players.B.areas.defense[0];
    const before = g.players.B.life;
    resolveBlock(g, def.id);
    expect(g.players.B.life).toBe(before);
    expect(g.pendingAttack).toBeNull();
  });

  it('not blocking deals damage equal to the attack value', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    const atk = g.players.A.areas.attack[0];
    doAttack(g, 'A', atk.id);
    const value = g.pendingAttack!.value;
    const before = g.players.B.life;
    resolveBlock(g);
    expect(g.players.B.life).toBe(before - value);
  });

  it('true damage ignores defense dice', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    const before = g.players.B.life;
    dealTrueDamage(g, 'B', 7);
    expect(g.players.B.life).toBe(before - 7);
  });

  it('ends the game when life reaches 0', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    dealTrueDamage(g, 'B', 50);
    expect(g.phase).toBe('gameOver');
    expect(g.winner).toBe('A');
  });
});
