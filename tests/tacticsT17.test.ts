// 战术牌 T17「诱敌」：受到对方伤害后，可把某区域最多 3 颗骰移到另一区域（整局 1 次）
import { describe, it, expect } from 'vitest';
import { createGame, applyAction, skipInitialReroll } from '../src/core/engine/game';
import { finalizeAttackResolution, dealTrueDamage } from '../src/core/engine/combat';
import { fxTake } from '../src/core/engine/fx';
import { TACTIC_POOL } from '../src/core/content/tactics';
import type { GameState, PendingAttack } from '../src/core/model/types';

const mk = (): GameState => {
  const g = createGame({
    seed: 1,
    firstPlayer: 'A',
    heroA: ['001', '002', '003'],
    heroB: ['001', '002', '003'],
    tacticA: 'T17',
    tacticB: 'T04',
  });
  skipInitialReroll(g);
  g.phase = 'main';
  g.players.A.life = 50;
  g.players.B.life = 50;
  return g;
};
const atkByB = (value: number): PendingAttack => ({ attacker: 'B', value, unblockable: false, physical: true });

describe('T17「诱敌」', () => {
  it('受到对方攻击伤害 → 挂可选待决策 youdiMove', () => {
    const g = mk();
    g.players.A.areas.attack = [{ id: 'x', value: 3, kind: 'attack' }];
    finalizeAttackResolution(g, atkByB(5), false);
    expect(g.pending?.kind).toBe('youdiMove');
  });

  it('发动：把来源区域最多 3 颗骰移到目标区域（保留点数）', () => {
    const g = mk();
    g.players.A.areas.attack = [
      { id: 'x', value: 3, kind: 'attack' },
      { id: 'y', value: 5, kind: 'attack' },
    ];
    g.players.A.areas.defense = [];
    finalizeAttackResolution(g, atkByB(5), false);
    applyAction(g, { t: 'youdiMove', from: 'attack', to: 'defense', dieIds: ['x', 'y'] });
    expect(g.players.A.areas.attack).toHaveLength(0);
    expect(g.players.A.areas.defense.map((d) => d.value).sort()).toEqual([3, 5]); // 保留点数
    expect(g.players.A.tacticOnceUsed).toBe(true);
    // O-2：换区走统一入口 `moveDice` → 必须发 `move` 旁路事件（不再靠界面"对比 DOM 猜"）
    expect(fxTake()).toContainEqual({ kind: 'move', player: 'A', dieIds: ['x', 'y'] });
  });

  it('不发动：不消耗整局 1 次（下次受伤可再挂）', () => {
    const g = mk();
    g.players.A.areas.attack = [{ id: 'x', value: 3, kind: 'attack' }];
    finalizeAttackResolution(g, atkByB(5), false);
    applyAction(g, { t: 'youdiMove', cancel: true });
    expect(g.players.A.tacticOnceUsed).toBe(false);
    expect(g.pending ?? null).toBeNull();
    // 再次受伤 → 再次出现
    finalizeAttackResolution(g, atkByB(5), false);
    expect(g.pending?.kind).toBe('youdiMove');
  });

  it('自伤不触发', () => {
    const g = mk();
    g.players.A.areas.attack = [{ id: 'x', value: 3, kind: 'attack' }];
    dealTrueDamage(g, 'A', 4, 'A');
    expect(g.pending ?? null).toBeNull();
  });

  it('用过后不再挂', () => {
    const g = mk();
    g.players.A.areas.attack = [{ id: 'x', value: 3, kind: 'attack' }];
    g.players.A.tacticOnceUsed = true;
    finalizeAttackResolution(g, atkByB(5), false);
    expect(g.pending ?? null).toBeNull();
  });

  it('初始生命修正：对方 −2', () => {
    const base = createGame({ seed: 1, firstPlayer: 'A' });
    const g = createGame({ seed: 1, firstPlayer: 'A', tacticA: 'T17', tacticB: 'T04' });
    expect(g.players.B.life).toBe(base.players.B.life - 2);
  });

  it('TACTIC_POOL 含 T17', () => {
    expect(TACTIC_POOL).toContain('T17');
  });
});
