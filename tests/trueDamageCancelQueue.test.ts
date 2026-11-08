// 009「高塔铁幕·触发」必须能响应**所有**来自对方的真实伤害（2026-11-07 修）。
//
// 用户实测：把 004「锋芒」的 2 点真实伤害打给持 009 的玩家时，从来不问「是否取消」。
// 根因：`dealTrueDamage` 里 009/慈悲 的挂起条件是 `g.pending === null`——而很多技能是在
// **自己的待决策还没清空时**造成真伤的（锋芒的 fengmang / 031 清算的 activationResolve /
// 技能内重掷），于是被静默跳过。
// 修法：板上被占 → `queuePending`（排队），伤害同样延后；当前那件事结算完再问。
import { describe, it, expect } from 'vitest';
import { applyAction, createGame } from '../src/core/engine/game';
import { dealTrueDamage } from '../src/core/engine/combat';
import { doReroll } from '../src/core/engine/phases';
import { SeededRng } from '../src/core/rng/rng';
import type { GameState } from '../src/core/model/types';

const game = (): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['004', '002', '003'], heroB: ['007', '008', '009'] });
  g.phase = 'main';
  g.activePlayer = 'A';
  return g;
};

const arm = (g: GameState, seat: 'A' | 'B', id: string, side: 'left' | 'right' = 'right') => {
  const a = g.players[seat].artifacts.find((x) => x.id === id);
  if (a) a.activeMarkerSide = side;
};

describe('009 高塔铁幕：板上被占时改为「排队」，不再静默跳过', () => {
  it('任意待决策占着板 → 伤害延后 + 排队一条 guwangCancel', () => {
    const g = game();
    arm(g, 'B', '009');
    g.players.B.areas.defense = [{ id: 'b-d1', value: 4, kind: 'defense' }];
    g.pending = { kind: 'caiyuliu', player: 'A', dieId: 'x', value: 3 } as never;
    const before = g.players.B.life;
    dealTrueDamage(g, 'B', 3, 'A');
    expect(g.players.B.life).toBe(before); // 延后，先不扣
    expect(g.pendingQueue.filter((p) => p.kind === 'guwangCancel')).toHaveLength(1);
  });

  it('没有防御骰 → 照常立刻扣血、不询问（回归）', () => {
    const g = game();
    arm(g, 'B', '009');
    g.players.B.areas.defense = [];
    const before = g.players.B.life;
    dealTrueDamage(g, 'B', 3, 'A');
    expect(g.players.B.life).toBe(before - 3);
    expect(g.pendingQueue.some((p) => p.kind === 'guwangCancel')).toBe(false);
  });

  it('027「凛冽之音」在**技能内重掷**造成的真伤也能被 009 响应', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['009', '002', '003'], heroB: ['027', '008', '007'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    arm(g, 'A', '009');
    g.players.A.areas.defense = [{ id: 'a-d1', value: 2, kind: 'defense' }];
    g.players.A.areas.attack = [{ id: 'a-x', value: 3, kind: 'attack' }];
    g.rerollPunish.B = true; // B 持有 027（充能生效）：任何人重掷 → 被重掷方受真伤
    g.pending = { kind: 'caiyuliu', player: 'A', dieId: 'x', value: 3 } as never;
    const before = g.players.A.life;
    doReroll(g, 'A', ['a-x'], new SeededRng(5));
    expect(g.players.A.life).toBe(before); // 延后
    expect(g.pendingQueue.some((p) => p.kind === 'guwangCancel' && p.player === 'A')).toBe(true);
  });

  it('004 锋芒 × 009：发动锋芒后必须询问，取消则那 2 点不落地', () => {
    const g = game();
    arm(g, 'A', '004', 'right'); // 锋芒（持续+触发）
    arm(g, 'B', '009');
    g.players.A.areas.attack = [
      { id: 'a-atk', value: 3, kind: 'attack' },
      { id: 'a-atk2', value: 5, kind: 'attack' }, // 锋芒代价用
    ];
    g.players.A.areas.meditation = [{ id: 'a-med', value: 4, kind: 'meditation' }];
    g.players.B.areas.defense = [
      { id: 'b-def', value: 2, kind: 'defense' }, // 用来抵挡（会被消耗）
      { id: 'b-def2', value: 6, kind: 'defense' }, // 留给「高塔铁幕」的代价
    ];
    g.players.B.areas.meditation = [{ id: 'b-med', value: 1, kind: 'meditation' }];

    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a-atk'] }] } as never);
    applyAction(g, { t: 'block', costSlots: [{ dieIds: ['b-def'] }] } as never);
    expect(g.pending?.kind).toBe('fengmang');

    const lifeBeforeFengmang = g.players.B.life;
    // 发动锋芒：攻击伤害立即落地；追加的 2 点真伤被延后并排队给 009
    applyAction(g, { t: 'fengmang', accept: true, attackDieId: 'a-atk2', meditationDieId: 'a-med' } as never);
    expect(g.pending?.kind).toBe('guwangCancel');
    expect((g.pending as { amount?: number } | null)?.amount).toBe(2);
    // 只扣了"攻击伤害"（＝少扣 2 点）
    const attackOnly = lifeBeforeFengmang - 3;
    expect(g.players.B.life).toBe(attackOnly);

    // 选「取消」→ 那 2 点永不落地（消耗 1 个防御骰 = b-def2）
    applyAction(g, { t: 'guwangCancel', cancel: true, defenseDieId: 'b-def2' } as never);
    expect(g.players.B.life).toBe(attackOnly);
  });

  it('004 锋芒 × 009：选「不取消」→ 那 2 点才落地', () => {
    const g = game();
    arm(g, 'A', '004', 'right');
    arm(g, 'B', '009');
    g.players.A.areas.attack = [
      { id: 'a-atk', value: 3, kind: 'attack' },
      { id: 'a-atk2', value: 5, kind: 'attack' },
    ];
    g.players.A.areas.meditation = [{ id: 'a-med', value: 4, kind: 'meditation' }];
    g.players.B.areas.defense = [
      { id: 'b-def', value: 2, kind: 'defense' }, // 用来抵挡
      { id: 'b-def2', value: 6, kind: 'defense' }, // 留给「高塔铁幕」的代价
    ];

    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a-atk'] }] } as never);
    applyAction(g, { t: 'block', costSlots: [{ dieIds: ['b-def'] }] } as never);
    const before = g.players.B.life;
    applyAction(g, { t: 'fengmang', accept: true, attackDieId: 'a-atk2', meditationDieId: 'a-med' } as never);
    expect(g.pending?.kind).toBe('guwangCancel');
    expect(g.players.B.life).toBe(before - 3); // 攻击伤害已落，2 点待决
    applyAction(g, { t: 'guwangCancel', cancel: false } as never);
    expect(g.players.B.life).toBe(before - 5); // 攻击 3 + 真伤 2
  });
});
