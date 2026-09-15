import { describe, it, expect } from 'vitest';
import { setupGame } from '../src/core/engine/setup';
import { doAttack, resolveBlock, dealTrueDamage } from '../src/core/engine/combat';
import { totalDice } from '../src/core/engine/derive';

describe('combat', () => {
  it('attack creates a pending attack with the die value and consumes the die', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    const die = g.players.A.areas.attack[0];
    const before = totalDice(g.players.A);
    doAttack(g, 'A', [{ dieIds: [die.id] }]);
    expect(g.pendingAttack).toMatchObject({
      attacker: 'A',
      value: die.value,
      unblockable: false,
      physical: true,
      sourceDieId: die.id,
      sourceValue: die.value,
    });
    expect(totalDice(g.players.A)).toBe(before - 1);
  });

  it('blocking prevents damage and consumes the defense die', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    const atk = g.players.A.areas.attack[0];
    doAttack(g, 'A', [{ dieIds: [atk.id] }]);
    const def = g.players.B.areas.defense[0];
    const before = g.players.B.life;
    resolveBlock(g, [{ dieIds: [def.id] }]);
    expect(g.players.B.life).toBe(before);
    expect(g.pendingAttack).toBeNull();
  });

  it('not blocking deals damage equal to the attack value', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    const atk = g.players.A.areas.attack[0];
    doAttack(g, 'A', [{ dieIds: [atk.id] }]);
    const value = g.pendingAttack!.value;
    const before = g.players.B.life;
    resolveBlock(g);
    expect(g.players.B.life).toBe(before - value);
  });

  it('logs a readable damage line', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    const atk = g.players.A.areas.attack[0];
    doAttack(g, 'A', [{ dieIds: [atk.id] }]);
    resolveBlock(g);
    const text = g.log.map((l) => l.text).join('\n');
    expect(text).toContain('玩家A 使用');
    expect(text).toContain('玩家B 未抵挡');
    expect(text).toContain('生命');
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

  it('does not allow a second attack while one is pending', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    g.players.A.areas.attack.push({ id: 'x1', value: 3, kind: 'attack' });
    g.players.A.areas.attack.push({ id: 'x2', value: 4, kind: 'attack' });
    doAttack(g, 'A', [{ dieIds: ['x1'] }]);
    expect(() => doAttack(g, 'A', [{ dieIds: ['x2'] }])).toThrow();
  });
});

import { attackDamageBuff } from '../src/core/engine/combat';

describe('锋芒 continuous', () => {
  it('adds 不祥 count as attack damage when active right', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    const buxiang = g.players.B.artifacts.find((a) => a.id === '004')!;
    expect(attackDamageBuff(g, 'B')).toBe(0);
    buxiang.activeMarkerSide = 'right';
    buxiang.count = 2;
    expect(attackDamageBuff(g, 'B')).toBe(2);
  });
  it('takes the max of buff and 锋芒 (golden rule)', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    const buxiang = g.players.B.artifacts.find((a) => a.id === '004')!;
    buxiang.activeMarkerSide = 'right';
    buxiang.count = 2;
    g.players.B.buffs.push({ attr: 'attackDamage', add: 5, duration: 'thisTurn' });
    expect(attackDamageBuff(g, 'B')).toBe(5);
  });
});

import { applyAction, getLegalActions } from '../src/core/engine/game';

describe('009 高塔铁幕 触发 (true damage cancel)', () => {
  function guwangGame() {
    const g = setupGame({ seed: 1, firstPlayer: 'A', heroB: ['009', '002', '003'] });
    const gw = g.players.B.artifacts.find((a) => a.id === '009')!;
    gw.activeMarkerSide = 'left';
    return g;
  }

  it('with the trigger active and a defense die, deals no damage until resolved', () => {
    const g = guwangGame();
    g.players.B.areas.defense = [{ id: 'd1', value: 4, kind: 'defense' }];
    const before = g.players.B.life;
    dealTrueDamage(g, 'B', 5);
    expect(g.pending).toEqual({ kind: 'guwangCancel', player: 'B', amount: 5 });
    expect(g.players.B.life).toBe(before);

    const legal = getLegalActions(g);
    expect(legal).toContainEqual({ t: 'guwangCancel', cancel: false });
    expect(legal).toContainEqual({ t: 'guwangCancel', cancel: true, defenseDieId: 'd1' });
  });

  it('resolving with cancel=true consumes the defense die and prevents the damage', () => {
    const g = guwangGame();
    g.players.B.areas.defense = [{ id: 'd1', value: 4, kind: 'defense' }];
    const before = g.players.B.life;
    dealTrueDamage(g, 'B', 5);
    applyAction(g, { t: 'guwangCancel', cancel: true, defenseDieId: 'd1' });
    expect(g.players.B.areas.defense.some((d) => d.id === 'd1')).toBe(false);
    expect(g.players.B.life).toBe(before);
    expect(g.pending).toBeNull();
  });

  it('resolving with cancel=false applies the deferred damage', () => {
    const g = guwangGame();
    g.players.B.areas.defense = [{ id: 'd1', value: 4, kind: 'defense' }];
    const before = g.players.B.life;
    dealTrueDamage(g, 'B', 5);
    applyAction(g, { t: 'guwangCancel', cancel: false });
    expect(g.players.B.life).toBe(before - 5);
    expect(g.players.B.areas.defense.length).toBe(1);
    expect(g.pending).toBeNull();
  });

  it('applies damage immediately without a defense die', () => {
    const g = guwangGame();
    g.players.B.areas.defense = [];
    const before = g.players.B.life;
    dealTrueDamage(g, 'B', 5);
    expect(g.pending).toBeNull();
    expect(g.players.B.life).toBe(before - 5);
  });

  it('applies damage immediately when the skill is not active', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', heroB: ['009', '002', '003'] });
    g.players.B.areas.defense = [{ id: 'd1', value: 4, kind: 'defense' }];
    const before = g.players.B.life;
    dealTrueDamage(g, 'B', 5);
    expect(g.pending).toBeNull();
    expect(g.players.B.life).toBe(before - 5);
  });

  it('applies damage immediately (no overwrite) when another pending exists', () => {
    const g = guwangGame();
    g.players.B.areas.defense = [{ id: 'd1', value: 4, kind: 'defense' }];
    g.pending = { kind: 'caiyuliu', player: 'A', dieId: 'x', value: 3 };
    const before = g.players.B.life;
    dealTrueDamage(g, 'B', 5);
    expect(g.pending.kind).toBe('caiyuliu');
    expect(g.players.B.life).toBe(before - 5);
  });
});
