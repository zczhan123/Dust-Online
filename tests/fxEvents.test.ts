import { describe, it, expect } from 'vitest';
import { applyAction, createGame, skipInitialReroll } from '../src/core/engine/game';
import { applyHeal, moveDice, paySlots } from '../src/core/engine/effects';
import { resolveBlock, applyMolu } from '../src/core/engine/combat';
import { applyTurnStartEffects } from '../src/core/engine/skills';
import { areaOf } from '../src/core/model/dice';
import { doReroll } from '../src/core/engine/phases';
import { SeededRng } from '../src/core/rng/rng';
import { fxReset, fxTake } from '../src/core/engine/fx';
import type { GameState } from '../src/core/model/types';

describe('动效旁路事件 · 回血（供 UI 显示 +0）', () => {
  it('满血回血 → 记录 actual=0', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    fxReset();
    g.players.A.life = g.players.A.lifeMax;
    const healed = applyHeal(g, 'A', 2);
    expect(healed).toBe(0);
    expect(fxTake()).toEqual([{ kind: 'heal', player: 'A', actual: 0 }]);
  });

  it('未满血回血 → 记录实际回复量', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    fxReset();
    g.players.A.life = g.players.A.lifeMax - 5;
    const healed = applyHeal(g, 'A', 2);
    expect(healed).toBe(2);
    expect(fxTake()).toEqual([{ kind: 'heal', player: 'A', actual: 2 }]);
  });

  it('fxReset 清空；fxTake 取走后清空', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    applyHeal(g, 'A', 1);
    fxReset();
    expect(fxTake()).toEqual([]);
    applyHeal(g, 'A', 1);
    expect(fxTake().length).toBe(1);
    expect(fxTake()).toEqual([]);
  });

  it('真实之剑置换（2 颗顶 1 颗）→ 记录整条"支付事件" pay', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    fxReset();
    g.players.A.areas.attack.push({ id: 'x1', value: 2, kind: 'attack' });
    g.players.A.areas.defense.push({ id: 'x2', value: 3, kind: 'defense' });
    const eff = paySlots(g, 'A', [{ kind: 'attack' }], [{ dieIds: ['x1', 'x2'] }], undefined, 'attack');
    expect(eff).toHaveLength(1);
    expect(eff[0].source).toBe('converted');
    expect(fxTake()).toContainEqual({
      kind: 'pay',
      player: 'A',
      removedIds: ['x1', 'x2'],
      groups: [['x1', 'x2']],
    });
  });

  it('doReroll → 记录 reroll 事件（无论点数是否变化）', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    fxReset();
    const ids = [
      ...g.players.A.areas.attack,
      ...g.players.A.areas.defense,
      ...g.players.A.areas.meditation,
    ].map((d) => d.id);
    expect(ids.length).toBeGreaterThan(0);
    doReroll(g, 'A', ids, new SeededRng(1));
    expect(fxTake()).toContainEqual({ kind: 'reroll', player: 'A', dieIds: ids });
  });

  it('moveDice → 记录 move 事件（区域移动/重排）', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    fxReset();
    const d =
      g.players.A.areas.attack[0] ?? g.players.A.areas.defense[0] ?? g.players.A.areas.meditation[0];
    moveDice(g, 'A', [d.id], 'attack');
    expect(fxTake()).toContainEqual({ kind: 'move', player: 'A', dieIds: [d.id] });
  });

  it('resolveBlock → 记录 block 事件（这次抵挡实际用的骰）', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    fxReset();
    g.pendingAttack = { attacker: 'A', value: 3, unblockable: false, physical: true };
    g.players.B.areas.defense.push({ id: 'bdef', value: 2, kind: 'defense' });
    resolveBlock(g, [{ dieIds: ['bdef'] }]);
    expect(
      fxTake().some((e) => e.kind === 'block' && e.player === 'B' && e.dieIds.includes('bdef')),
    ).toBe(true);
  });

  it('支付用到存放骰（034 破障）→ pay 事件带 fromCard', () => {
    const g = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['034', '001', '002'],
      heroB: ['004', '005', '006'],
    });
    fxReset();
    const a034 = g.players.A.artifacts.find((a) => a.id === '034')!;
    a034.activeMarkerSide = 'left'; // 破障（持续·左）生效
    a034.heldDice = [{ id: 'held1', value: 2 }];
    const dist = g.players.A.artifacts.find((a) => a.column === 2)!.distribution!;
    const kind = areaOf(2, dist);
    const eff = paySlots(g, 'A', [{ kind }], [{ dieIds: ['held1'] }], undefined, 'attack');
    expect(eff).toHaveLength(1);
    expect(fxTake()).toContainEqual({
      kind: 'pay',
      player: 'A',
      removedIds: ['held1'],
      groups: [],
      fromCard: ['held1'],
    });
  });
});

describe('动效旁路事件 · 023 畏惧（响应池：发起方停中间 → 对方到位并排）', () => {
  /** A 持 022/023/024（希瓦），B 持 004/005/006（影） */
  const xivaGame = (heroA: [string, string, string] = ['022', '023', '024']): GameState => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA, heroB: ['004', '005', '006'] });
    skipInitialReroll(g);
    return g;
  };
  const toMain = (g: GameState): void => {
    let guard = 0;
    while (g.phase !== 'main' && g.phase !== 'gameOver' && guard++ < 12) applyAction(g, { t: 'advance' });
  };
  const arm = (g: GameState, who: 'A' | 'B', id: string, side: 'left' | 'right'): void => {
    const a = g.players[who].artifacts.find((x) => x.id === id)!;
    a.activeMarkerSide = side;
    a.armedSide = side;
    a.armedTurn = g.turnIndex;
  };

  it('发起方付骰 → weiju initiate（dieIds / value）', () => {
    const g = xivaGame();
    toMain(g);
    arm(g, 'A', '023', 'left');
    g.players.A.areas.meditation = [{ id: 'my', value: 5, kind: 'meditation' }];
    g.players.B.areas.attack = [{ id: 'theirs', value: 2, kind: 'attack' }];
    applyAction(g, { t: 'skill', artifactId: '023', side: 'left', params: { dieId: 'my' } });
    expect(g.pending?.kind).toBe('weijuPay');
    expect(fxTake()).toContainEqual({ kind: 'weiju', player: 'A', mode: 'initiate', dieIds: ['my'], value: 5 });
  });

  it('被要求方付骰 → weiju pay（dieIds / value）', () => {
    const g = xivaGame();
    toMain(g);
    arm(g, 'A', '023', 'left');
    g.players.A.areas.meditation = [{ id: 'my', value: 5, kind: 'meditation' }];
    g.players.B.areas.attack = [{ id: 'theirs', value: 2, kind: 'attack' }];
    applyAction(g, { t: 'skill', artifactId: '023', side: 'left', params: { dieId: 'my' } });
    fxTake(); // 丢弃发起帧事件
    applyAction(g, { t: 'weijuPay', dieId: 'theirs' });
    expect(fxTake()).toContainEqual({ kind: 'weiju', player: 'B', mode: 'pay', dieIds: ['theirs'], value: 2 });
  });

  it('用 010 真实之剑置换支付 → dieIds 为 2 颗源骰、value=5', () => {
    const g = xivaGame(['010', '023', '001']);
    toMain(g);
    arm(g, 'A', '010', 'left'); // 真实之剑（持续·左）
    arm(g, 'A', '023', 'left');
    g.players.A.areas.meditation = [
      { id: 'm1', value: 2, kind: 'meditation' },
      { id: 'm2', value: 3, kind: 'meditation' },
    ];
    g.players.B.areas.attack = [{ id: 'theirs', value: 2, kind: 'attack' }];
    applyAction(g, { t: 'skill', artifactId: '023', side: 'left', params: { costSlots: [{ dieIds: ['m1', 'm2'] }] } });
    expect(fxTake()).toContainEqual({ kind: 'weiju', player: 'A', mode: 'initiate', dieIds: ['m1', 'm2'], value: 5 });
  });
});

describe('动效旁路事件 · 尘起"开"气泡（rise）', () => {
  const setupDust = (): GameState => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] });
    skipInitialReroll(g);
    g.phase = 'dustRise';
    g.activePlayer = 'A';
    g.players.A.areas.meditation = [{ id: 'md', value: 3, kind: 'meditation' }];
    return g;
  };

  it('首次激活 → mode=activate', () => {
    const g = setupDust();
    applyAction(g, { t: 'dustRise', artifactId: '001', side: 'left', costSlots: [{ dieIds: ['md'] }] });
    expect(fxTake()).toContainEqual({ kind: 'rise', player: 'A', artifactId: '001', side: 'left', mode: 'activate' });
  });

  it('切换到另一侧 → mode=switch', () => {
    const g = setupDust();
    g.players.A.artifacts.find((a) => a.id === '001')!.activeMarkerSide = 'left';
    applyAction(g, { t: 'dustRise', artifactId: '001', side: 'right', costSlots: [{ dieIds: ['md'] }] });
    expect(fxTake()).toContainEqual({ kind: 'rise', player: 'A', artifactId: '001', side: 'right', mode: 'switch' });
  });

  it('第三列充能 → mode=charge / side=only', () => {
    const g = setupDust();
    applyAction(g, { t: 'dustRise', artifactId: '003', costSlots: [{ dieIds: ['md'] }] });
    expect(fxTake()).toContainEqual({ kind: 'rise', player: 'A', artifactId: '003', side: 'only', mode: 'charge' });
  });
});

describe('动效旁路事件 · 技能"用"气泡（skillFired）', () => {
  it('发动「畏惧」（启动）→ skillFired auto:false', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['022', '023', '024'], heroB: ['004', '005', '006'] });
    skipInitialReroll(g);
    let guard = 0;
    while (g.phase !== 'main' && g.phase !== 'gameOver' && guard++ < 12) applyAction(g, { t: 'advance' });
    const a = g.players.A.artifacts.find((x) => x.id === '023')!;
    a.activeMarkerSide = 'left';
    a.armedSide = 'left';
    a.armedTurn = g.turnIndex;
    g.players.A.areas.meditation = [{ id: 'my', value: 5, kind: 'meditation' }];
    g.players.B.areas.attack = [{ id: 'theirs', value: 2, kind: 'attack' }];
    applyAction(g, { t: 'skill', artifactId: '023', side: 'left', params: { dieId: 'my' } });
    expect(fxTake()).toContainEqual({ kind: 'skillFired', player: 'A', artifactId: '023', side: 'left', skillKey: 'shexie.weiju', auto: false });
  });
});

describe('动效旁路事件 · 战术效果气泡（tacticFired）', () => {
  it('T04 末路生效 → tacticFired', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] });
    skipInitialReroll(g);
    g.players.A.tactic = 'T04';
    fxReset();
    applyMolu(g, 'A');
    expect(fxTake()).toContainEqual({ kind: 'tacticFired', player: 'A', tacticId: 'T04' });
  });
});

describe('动效旁路事件 · 强制·非增伤持续生效（skillFired auto:true）', () => {
  it('008 战车：回合开始得骰 → skillFired auto:true', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['007', '008', '009'], heroB: ['001', '002', '003'] });
    skipInitialReroll(g);
    const a008 = g.players.A.artifacts.find((a) => a.id === '008')!;
    a008.activeMarkerSide = 'left';
    a008.armedSide = 'left';
    a008.armedTurn = g.turnIndex;
    g.players.A.areas.defense.push({ id: 'd1', value: 2, kind: 'defense' });
    fxReset();
    applyTurnStartEffects(g, 'A');
    expect(fxTake()).toContainEqual({ kind: 'skillFired', player: 'A', artifactId: '008', side: 'left', skillKey: 'tiebi.chariot', auto: true });
  });
});

describe('动效旁路事件 · 攻击池并排（011 补一颗 / 034 取消）', () => {
  it('011 灵能屏障付费 → attackJoin(spend)', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['013', '011', '015'] });
    skipInitialReroll(g);
    let guard = 0;
    while (g.phase !== 'main' && g.phase !== 'gameOver' && guard++ < 12) applyAction(g, { t: 'advance' });
    const b011 = g.players.B.artifacts.find((a) => a.id === '011')!;
    b011.activeMarkerSide = 'left';
    b011.armedSide = 'left';
    b011.armedTurn = g.turnIndex;
    g.players.A.areas.attack.push({ id: 'a1', value: 3, kind: 'attack' });
    g.players.B.areas.meditation.push({ id: 'b-med', value: 2, kind: 'meditation' });
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    expect(g.pending?.kind).toBe('dunwuHalve');
    applyAction(g, { t: 'dunwuHalve', accept: true, meditationDieId: 'b-med' });
    expect(fxTake()).toContainEqual({ kind: 'attackJoin', player: 'B', mode: 'spend', dieIds: ['b-med'], value: 2 });
  });
});
