// 战术牌 × 神器/传奇 兼容性检查（机制法）。
// 只测"战术牌碰到的规范原语"与相关卡的联动：真伤拦截（009/L11）、受伤计数（018）、
// 支付触发（026 威压）、规则顺序（T09 慈悲 vs 009）。逐卡自身的规则见 tacticsT*.test.ts。
import { describe, it, expect } from 'vitest';
import { createGame, applyAction, skipInitialReroll, beginTurn } from '../src/core/engine/game';
import { pumpPending } from '../src/core/engine/pending';
import { applyMolu, dealTrueDamage, noteFirstDamageFromOpponent } from '../src/core/engine/combat';
import type { GameState, PlayerId } from '../src/core/model/types';

const art = (g: GameState, who: PlayerId, id: string) => g.players[who].artifacts.find((a) => a.id === id)!;
const arm = (g: GameState, who: PlayerId, id: string, side: 'left' | 'right') => {
  const a = art(g, who, id);
  a.activeMarkerSide = side;
  a.armedSide = side;
  a.armedTurn = g.turnIndex;
};

describe('战术牌 × 神器/传奇 兼容性（机制）', () => {
  it('T04 末路 × 009 高塔铁幕：末路的真伤可被目标消耗防御骰取消（回复仍结算）', () => {
    const g = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['001', '002', '003'], // 第三列 003：chargeReq 4
      heroB: ['007', '008', '009'], // 009 高塔铁幕
      tacticA: 'T04',
      tacticB: 'T03',
    });
    g.phase = 'main';
    g.players.A.life = 20;
    g.players.A.lifeMax = 50;
    g.players.B.life = 40;
    g.players.B.lifeMax = 50;
    arm(g, 'B', '009', 'left');
    g.players.B.areas.defense = [{ id: 'bd', value: 3, kind: 'defense' }];
    applyMolu(g, 'A');
    expect(g.pending?.kind).toBe('guwangCancel'); // 009 挂起取消
    expect(g.players.B.life).toBe(40); // 真伤未落下
    expect(g.players.A.life).toBe(24); // 末路"回复"仍结算（造成与否两行）
  });

  it('T04 末路 × 018 强制必杀 × 009：强制路径下末路真伤**也能**被取消（回归 2026-10-07 裁定 B）', () => {
    const g = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['001', '002', '018'], // 018 漆黑绽放（第三列）
      heroB: ['007', '008', '009'], // 009 高塔铁幕
      tacticA: 'T04',
      tacticB: 'T03',
    });
    const bloom = art(g, 'A', '018');
    const req = bloom.chargeReq ?? 0;
    expect(req).toBeGreaterThan(0);
    g.players.A.life = 20;
    g.players.A.lifeMax = 50;
    g.players.B.life = 40;
    g.players.B.lifeMax = 50;
    arm(g, 'B', '009', 'left');
    g.players.B.areas.defense = [{ id: 'bd', value: 3, kind: 'defense' }];
    bloom.activeMarkerSide = 'left';
    bloom.armedSide = 'left';
    bloom.armedTurn = g.turnIndex;
    bloom.count = 5;

    pumpPending(g); // 触发 018 强制必杀
    // 末路真伤**先**挂起 009 的「取消」待决策（修复前：待决策是 zhihaiReroll、真伤被无声打实）
    expect(g.pending?.kind).toBe('guwangCancel');
    expect(g.players.B.life).toBe(40);
    // 「漆黑绽放重掷」排在队列里（不覆盖、不丢失）
    expect(g.pendingQueue.some((q) => q.kind === 'zhihaiReroll')).toBe(true);
  });

  it('T04 末路 × L11 永恒女王：末路致死真伤被拦截 → 目标不死', () => {
    const g = createGame({
      seed: 1,
      firstPlayer: 'A',
      legendA: 'L02', // 藏地花：开局即可用的必杀
      heroA: ['001', '002', '003'],
      legendB: 'L11', // 永恒女王
      heroB: ['001', '002', '003'],
      tacticA: 'T04',
      tacticB: 'T03',
    });
    g.dustfall = 1;
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.A.life = 20;
    g.players.A.lifeMax = 50;
    g.players.B.life = 3; // 末路 4 点真伤 = 致死
    g.players.B.lifeMax = 50;
    applyAction(g, { t: 'skill', artifactId: 'L02', side: 'only', params: {} });
    expect(g.players.B.life).toBe(3); // 被永恒女王拦截，未死
    expect(g.legendOnceUsed).toContain('B:aiwa.yonghengnvwang');
  });

  it('T08 无情 × 009 高塔铁幕：无情的 2 点真伤被拦取消', () => {
    const g = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['007', '008', '009'],
      heroB: ['001', '002', '003'],
      tacticA: 'T03',
      tacticB: 'T08', // 无情：对方回合开始时若任一方 ≤20 → 本回合玩家受 2 真伤
    });
    skipInitialReroll(g);
    arm(g, 'A', '009', 'left');
    g.players.A.areas.defense = [{ id: 'ad', value: 3, kind: 'defense' }];
    g.players.A.life = 50;
    g.players.B.life = 20; // 触发无情
    g.activePlayer = 'A';
    beginTurn(g);
    expect(g.pending?.kind).toBe('guwangCancel');
    expect(g.players.A.life).toBe(50); // 2 真伤被拦
  });

  it('T08 无情 × 018 至黑：受伤（真伤）计入至黑计数', () => {
    const g = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['001', '002', '018'], // 018 至黑
      heroB: ['001', '002', '003'],
      tacticA: 'T03',
      tacticB: 'T08',
    });
    skipInitialReroll(g);
    arm(g, 'A', '018', 'left');
    g.players.B.life = 20;
    g.activePlayer = 'A';
    beginTurn(g);
    expect(art(g, 'A', '018').count).toBe(1);
  });

  it('T13 远见 × 009 高塔铁幕：真伤被取消 = 生命未下降 → 不算"最先 ≤20"', () => {
    const g = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['001', '002', '003'],
      heroB: ['007', '008', '009'],
      tacticA: 'T13',
      tacticB: 'T03',
    });
    applyAction(g, { t: 'tacticGuess', who: 'B' });
    arm(g, 'B', '009', 'left');
    g.players.B.areas.defense = [{ id: 'bd', value: 3, kind: 'defense' }];
    g.players.B.life = 30;
    g.phase = 'main';
    dealTrueDamage(g, 'B', 30, 'A'); // 本会把 B 打到 0，但被 009 拦下
    expect(g.pending?.kind).toBe('guwangCancel');
    expect(g.players.B.life).toBe(30);
    expect(g.tacticLowFirst).toBeNull(); // 未真正下降 → 不触线、不发奖
  });

  it('T14 赴火 × 009 高塔铁幕：反弹的真伤同样可被对方 009 取消', () => {
    const g = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['001', '002', '003'],
      heroB: ['007', '008', '009'],
      tacticA: 'T14',
      tacticB: 'T03',
    });
    g.phase = 'main';
    arm(g, 'B', '009', 'left');
    g.players.B.areas.defense = [{ id: 'bd', value: 3, kind: 'defense' }];
    g.players.B.life = 40;
    noteFirstDamageFromOpponent(g, 'A', 5, 'B'); // A 首次受 B 的 5 伤害 → 反弹 5 给 B
    expect(g.players.A.tacticOnceUsed).toBe(true);
    expect(g.pending?.kind).toBe('guwangCancel'); // B 的 009 拦下反弹
    expect(g.players.B.life).toBe(40);
  });

  it('T12 激进 × 026 威压：第三列额外充能支付冥想骰 → 触发威压', () => {
    const g = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['001', '026', '003'], // 026 威压（第二列）、003（第三列）
      heroB: ['001', '002', '003'],
      tacticA: 'T12',
      tacticB: 'T03',
    });
    skipInitialReroll(g);
    arm(g, 'A', '026', 'right');
    g.phase = 'dustRise';
    g.activePlayer = 'A';
    g.firstRound.A = true;
    g.dustRiseNormalCount = 1; // 正常次数已用 → 走 T12 额外充能
    g.players.A.areas.meditation = [{ id: 'm1', value: 2, kind: 'meditation' }];
    applyAction(g, { t: 'dustRise', artifactId: '003', costSlots: [{ dieIds: ['m1'] }] });
    expect(g.players.A.tacticOnceUsed).toBe(true); // 额外充能已用
    expect(art(g, 'A', '003').chargeLayer).toBe(1);
    expect(g.pending?.kind).toBe('weiyaPick'); // 尘起支付 → 威压触发
  });

  it('T09 慈悲 × 009 高塔铁幕：顺序固定为「先来源方慈悲、后目标方铁幕」', () => {
    const g = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['001', '002', '003'],
      heroB: ['007', '008', '009'],
      tacticA: 'T09', // 慈悲：造成者可取消伤害改回复
      tacticB: 'T03',
    });
    g.phase = 'main';
    arm(g, 'B', '009', 'left');
    g.players.B.areas.defense = [{ id: 'bd', value: 3, kind: 'defense' }];
    g.players.B.life = 40;
    dealTrueDamage(g, 'B', 5, 'A');
    expect(g.pending?.kind).toBe('ciBei'); // 先问来源方（A 的慈悲）
    applyAction(g, { t: 'ciBei', accept: false }); // A 不发动 → 照常造成
    expect(g.pending?.kind).toBe('guwangCancel'); // 再轮到目标方（B 的 009）
    expect(g.players.B.life).toBe(40);
  });
});
