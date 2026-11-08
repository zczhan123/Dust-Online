import { describe, it, expect } from 'vitest';
import { applyAction, createGame, createTwoVTwoGame, skipInitialReroll } from '../src/core/engine/game';
import { toMain } from './helpers';
import type { GameState, PlayerId } from '../src/core/model/types';
import type { TwoVTwoSetup } from '../src/core/model/twoVTwo';

const art = (g: GameState, who: PlayerId, id: string) => g.players[who].artifacts.find((a) => a.id === id)!;

const clearAreas = (g: GameState, who: PlayerId): void => {
  g.players[who].areas = { attack: [], defense: [], meditation: [] };
};

const game = (heroA: [string, string, string], heroB: [string, string, string]): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA, heroB });
  skipInitialReroll(g);
  toMain(g);
  return g;
};

/** 011「灵能脉冲·触发」在**右侧** → 把标记装到右侧 */
const pulseOn = (g: GameState, who: PlayerId): void => {
  art(g, who, '011').activeMarkerSide = 'right';
};

const hasLog = (g: GameState, needle: string): boolean => g.log.some((e) => e.text.includes(needle));

/**
 * 011「灵能脉冲·触发」的全来源覆盖。
 *
 * 历史问题：触发判定只写在 `case 'skill'` 尾部，且消耗量靠各调用点手动 `reportConsumed` 上报 →
 * 004 锋芒 / 013 电刑 / 019 蛮王之牙 / 009 高塔铁幕 / 030 寰宇飞升 这些**别的动作类型**结构上走不到 → 静默漏触发。
 * 现在：记账统一在 `paySlots`（reason='skill'，按付款人记格数），判定统一在 `applyAction` 收尾（全动作类型）。
 */
describe('011 灵能脉冲·触发：全来源覆盖（按付款人记账）', () => {
  it('004 锋芒·触发：消耗 1 攻 + 1 冥 → 脉冲 2 点', () => {
    const g = game(['004', '011', '003'], ['001', '002', '003']);
    pulseOn(g, 'A');
    clearAreas(g, 'A');
    g.players.A.areas.attack = [{ id: 'a1', value: 2, kind: 'attack' }];
    g.players.A.areas.meditation = [{ id: 'm1', value: 3, kind: 'meditation' }];
    g.players.B.life = 40;
    g.pending = { kind: 'fengmang', player: 'A', defenderId: 'B', value: 3 };
    applyAction(g, { t: 'fengmang', accept: true, attackDieId: 'a1', meditationDieId: 'm1' });
    // 计数器在动作收尾已转成待决策并清空；扣骰发生（消费真实骰）
    expect(g.players.A.areas.attack).toEqual([]);
    expect(g.players.A.areas.meditation).toEqual([]);
    expect(g.pending).toEqual({ kind: 'dunwuPulse', player: 'A', amount: 2 });
  });

  it('013 电刑：消耗 2 冥 → 脉冲先于三连击（攻击队列已建、尚未开打）', () => {
    const g = game(['013', '011', '003'], ['001', '002', '003']);
    pulseOn(g, 'A');
    clearAreas(g, 'A');
    g.players.A.areas.meditation = [
      { id: 'm1', value: 2, kind: 'meditation' },
      { id: 'm2', value: 4, kind: 'meditation' },
    ];
    art(g, 'A', '013').activeMarkerSide = 'left';
    g.pending = { kind: 'dianxing', player: 'A', values: [1, 2, 3] };
    applyAction(g, { t: 'dianxing', dieIds: ['m1', 'm2'] });
    expect(g.pending).toEqual({ kind: 'dunwuPulse', player: 'A', amount: 2 });
    // 三连击已排队但**尚未开打**（等脉冲决定）
    expect(g.attackQueue?.values).toEqual([1, 2, 3]);
    expect(g.pendingAttack).toBeNull();
    // 脉冲决定后，三连击一段不少地继续（先打第 1 段）
    applyAction(g, { t: 'dunwuPulse', accept: false });
    expect(g.pendingAttack?.baseValue).toBe(1);
    expect(g.attackQueue?.values).toEqual([2, 3]); // 第 1 段已开打，剩 2 段在队列里
  });

  it('019 蛮王之牙：消耗 2 颗不同类骰 → 效果全部执行后才问脉冲（2 点）', () => {
    const g = game(['019', '011', '003'], ['001', '002', '003']);
    pulseOn(g, 'A');
    clearAreas(g, 'A');
    g.players.A.areas.attack = [{ id: 'k1', value: 2, kind: 'attack' }];
    g.players.A.areas.defense = [{ id: 'k2', value: 4, kind: 'defense' }];
    art(g, 'A', '019').activeMarkerSide = 'right';
    applyAction(g, {
      t: 'skill',
      artifactId: '019',
      side: 'right',
      params: { costSlots: [{ dieIds: ['k1'] }, { dieIds: ['k2'] }], picks: ['gain', 'gain'] },
    });
    // 「获得 2 个 3 点攻击骰」已经执行完，然后才挂脉冲
    expect(g.players.A.areas.attack.filter((d) => d.value === 3).length).toBe(2);
    expect(g.pending).toEqual({ kind: 'dunwuPulse', player: 'A', amount: 2 });
  });

  it('009 高塔铁幕·触发：消耗 1 防 → 脉冲 1 点（同一人持 009 + 011）', () => {
    const g = game(['001', '002', '003'], ['001', '011', '009']);
    pulseOn(g, 'B');
    clearAreas(g, 'B');
    g.players.B.areas.defense = [{ id: 'bd1', value: 4, kind: 'defense' }];
    g.pending = { kind: 'guwangCancel', player: 'B', amount: 3, source: 'A' };
    applyAction(g, { t: 'guwangCancel', cancel: true, defenseDieId: 'bd1' });
    expect(g.players.B.areas.defense).toEqual([]); // 真的消耗了 1 颗
    expect(g.pending).toEqual({ kind: 'dunwuPulse', player: 'B', amount: 1 });
  });

  it('030 寰宇飞升：消耗 4 冥想骰 → 得骰与回血都已结算后才问脉冲（4 点）', () => {
    const g = game(['001', '011', '030'], ['001', '002', '003']);
    pulseOn(g, 'A');
    clearAreas(g, 'A');
    g.players.A.areas.meditation = [1, 2, 3, 4].map((v) => ({ id: `m${v}`, value: v, kind: 'meditation' as const }));
    g.players.A.life = g.players.A.lifeMax - 20;
    art(g, 'A', '030').activeMarkerSide = 'left';
    const before = g.players.A.life;
    applyAction(g, {
      t: 'skill',
      artifactId: '030',
      side: 'only',
      params: { costSlots: [1, 2, 3, 4].map((v) => ({ dieIds: [`m${v}`] })) },
    });
    expect(g.players.A.areas.attack.length).toBe(3);
    expect(g.players.A.areas.defense.length).toBe(3);
    expect(g.players.A.life).toBe(before + 10);
    expect(g.pending).toEqual({ kind: 'dunwuPulse', player: 'A', amount: 4 });
  });
});

describe('011 灵能脉冲：多次触发、一回合只用 1 次', () => {
  it('接受第一条后，后面排队的触发被跳过（有战报、无第二个面板）', () => {
    const g = game(['001', '011', '003'], ['001', '002', '003']);
    pulseOn(g, 'A');
    g.pending = { kind: 'dunwuPulse', player: 'A', amount: 2 };
    g.pendingQueue.push({ kind: 'dunwuPulse', player: 'A', amount: 1 });
    applyAction(g, { t: 'dunwuPulse', accept: true });
    expect(g.pending).toBeNull();
    expect(g.pendingQueue).toEqual([]);
    expect(g.dunwuPulseUsed.A).toBe(true);
    expect(hasLog(g, '本回合已使用 → 跳过')).toBe(true);
  });

  it('不发动不消耗配额：同回合可以再次触发', () => {
    const g = game(['001', '011', '003'], ['001', '002', '003']);
    pulseOn(g, 'A');
    g.pending = { kind: 'dunwuPulse', player: 'A', amount: 2 };
    applyAction(g, { t: 'dunwuPulse', accept: false });
    expect(g.dunwuPulseUsed.A ?? false).toBe(false);
    // 同回合再来一次消耗 → 仍会问
    clearAreas(g, 'A');
    g.players.A.areas.meditation = [
      { id: 'm1', value: 2, kind: 'meditation' },
      { id: 'm2', value: 3, kind: 'meditation' },
    ];
    art(g, 'A', '001').activeMarkerSide = 'left';
    g.players.B.areas.defense = [{ id: 'bd1', value: 1, kind: 'defense' }];
    applyAction(g, {
      t: 'skill',
      artifactId: '001',
      side: 'left',
      params: { costSlots: [{ dieIds: ['m1'] }, { dieIds: ['m2'] }], opponentDefenseDieIds: ['bd1'] },
    });
    expect(g.pending).toEqual({ kind: 'dunwuPulse', player: 'A', amount: 2 });
  });

});

describe('011 灵能脉冲：真伤 → 对方「高塔铁幕」连锁', () => {
  const make = (): GameState => {
    const g = game(['001', '011', '003'], ['001', '002', '009']);
    art(g, 'B', '009').activeMarkerSide = 'left'; // 009 的「触发」在 only 侧（需要已装填标记）
    g.players.B.areas.defense = [{ id: 'bd1', value: 3, kind: 'defense' }];
    g.players.B.life = 40;
    g.pending = { kind: 'dunwuPulse', player: 'A', amount: 2 };
    return g;
  };

  it('对方取消：消耗 1 防御骰、不扣血', () => {
    const g = make();
    applyAction(g, { t: 'dunwuPulse', accept: true, target: 'B' });
    expect(g.pending?.kind).toBe('guwangCancel');
    expect(g.pending && 'amount' in g.pending ? g.pending.amount : -1).toBe(2);
    applyAction(g, { t: 'guwangCancel', cancel: true, defenseDieId: 'bd1' });
    expect(g.players.B.life).toBe(40);
  });

  it('对方不取消：正常扣 2 点', () => {
    const g = make();
    applyAction(g, { t: 'dunwuPulse', accept: true, target: 'B' });
    applyAction(g, { t: 'guwangCancel', cancel: false });
    expect(g.players.B.life).toBe(38);
  });

  it('对方没有防御骰 → 不弹询问，直接扣血', () => {
    const g = make();
    g.players.B.areas.defense = [];
    applyAction(g, { t: 'dunwuPulse', accept: true, target: 'B' });
    expect(g.pending).toBeNull();
    expect(g.players.B.life).toBe(38);
  });
});

describe('011 灵能脉冲：2v2（按付款人记账，队友消耗不触发）', () => {
  const setup2v2 = (a1: string[], a2: string[]): TwoVTwoSetup => ({
    seats: {
      A1: a1 as [string, string, string],
      A2: a2 as [string, string, string],
      B1: ['001', '002', '003'],
      B2: ['004', '005', '006'],
    },
    firstTeam: 'A',
    seed: 7,
  });

  it('A1 持 011、队友 A2 消耗 → 不触发', () => {
    const g = createTwoVTwoGame(setup2v2(['001', '011', '003'], ['004', '005', '006']));
    art(g, 'A1', '011').activeMarkerSide = 'right';
    g.players.A2.areas.meditation = [
      { id: 'm1', value: 2, kind: 'meditation' },
      { id: 'm2', value: 4, kind: 'meditation' },
    ];
    g.pending = { kind: 'dianxing', player: 'A2', values: [1, 2, 3] };
    applyAction(g, { t: 'dianxing', dieIds: ['m1', 'm2'], targets: ['B1', 'B2', 'B1'] });
    expect(g.players.A2.areas.meditation).toEqual([]); // A2 确实消耗了
    expect(g.skillConsumedThisAction).toEqual({}); // 记账已转成待决策（本动作无脉冲可生成）
    expect(g.pending).toBeNull();
  });

  it('A2 自己持 011 → 消耗后触发，且决策人＝A2', () => {
    const g = createTwoVTwoGame(setup2v2(['001', '002', '003'], ['004', '011', '006']));
    art(g, 'A2', '011').activeMarkerSide = 'right';
    g.players.A2.areas.meditation = [
      { id: 'm1', value: 2, kind: 'meditation' },
      { id: 'm2', value: 4, kind: 'meditation' },
    ];
    g.pending = { kind: 'dianxing', player: 'A2', values: [1, 2, 3] };
    applyAction(g, { t: 'dianxing', dieIds: ['m1', 'm2'], targets: ['B1', 'B2', 'B1'] });
    expect(g.pending).toEqual({ kind: 'dunwuPulse', player: 'A2', amount: 2 });
  });
});
