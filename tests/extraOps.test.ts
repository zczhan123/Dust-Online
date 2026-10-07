import { describe, it, expect } from 'vitest';
import { createGame, applyAction, skipInitialReroll, beginTurn } from '../src/core/engine/game';
import { checkLifeTens } from '../src/core/engine/effects';
import { fxReset, fxTake } from '../src/core/engine/fx';
import type { GameState } from '../src/core/model/types';

const firedKey = (key: string): boolean =>
  fxTake().some((e) => e.kind === 'skillFired' && e.skillKey === key);

describe('额外操作事件 · 龙游万象（重掷第 2 次才弹）', () => {
  it('第 1 次重掷不发、第 2 次发 youlong.wanxiang', () => {
    const g: GameState = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] });
    skipInitialReroll(g);
    const a002 = g.players.A.artifacts.find((a) => a.id === '002')!;
    a002.activeMarkerSide = 'left';
    a002.armedSide = 'left';
    a002.armedTurn = g.turnIndex;
    g.phase = 'reroll';
    g.activePlayer = 'A';
    g.players.A.areas.attack = [
      { id: 'd1', value: 2, kind: 'attack' },
      { id: 'd2', value: 3, kind: 'attack' },
    ];
    applyAction(g, { t: 'reroll', dieIds: ['d1'] });
    expect(firedKey('youlong.wanxiang')).toBe(false);
    applyAction(g, { t: 'reroll', dieIds: ['d2'] });
    expect(firedKey('youlong.wanxiang')).toBe(true);
  });
});

describe('额外操作事件 · 残影（第 2 次才弹）', () => {
  it('尘起：第 1 次不发、第 2 次发 ying.canying', () => {
    const g: GameState = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'], legendA: 'L02' });
    skipInitialReroll(g);
    g.phase = 'dustRise';
    g.activePlayer = 'A';
    g.players.A.areas.meditation = [
      { id: 'm1', value: 1, kind: 'meditation' },
      { id: 'm2', value: 2, kind: 'meditation' },
    ];
    applyAction(g, { t: 'dustRise', artifactId: '001', side: 'left', costSlots: [{ dieIds: ['m1'] }] });
    expect(firedKey('ying.canying')).toBe(false);
    applyAction(g, { t: 'dustRise', artifactId: '002', side: 'left', costSlots: [{ dieIds: ['m2'] }] });
    expect(firedKey('ying.canying')).toBe(true);
  });

  it('影袭：第 1 次不发、第 2 次发 ying.canying', () => {
    const g: GameState = createGame({ seed: 1, firstPlayer: 'A', heroA: ['004', '005', '006'], heroB: ['001', '002', '003'], legendA: 'L02' });
    skipInitialReroll(g);
    let guard = 0;
    while (g.phase !== 'main' && g.phase !== 'gameOver' && guard++ < 12) applyAction(g, { t: 'advance' });
    const a005 = g.players.A.artifacts.find((a) => a.id === '005')!;
    a005.activeMarkerSide = 'left';
    a005.armedSide = 'left';
    a005.armedTurn = g.turnIndex;
    g.players.A.areas.meditation = [
      { id: 'x1', value: 5, kind: 'meditation' },
      { id: 'x2', value: 4, kind: 'meditation' },
    ];
    applyAction(g, { t: 'skill', artifactId: '005', side: 'left', params: { dieId: 'x1', x: 1 } });
    expect(firedKey('ying.canying')).toBe(false);
    applyAction(g, { t: 'block' }); // 先解决影袭发起的虚拟攻击，否则 pendingAttack 未决
    applyAction(g, { t: 'skill', artifactId: '005', side: 'left', params: { dieId: 'x2', x: 1 } });
    expect(firedKey('ying.canying')).toBe(true);
  });
});

describe('额外操作事件 · L05 复仇之灵（授予额外尘起时弹）', () => {
  it('生命十位数变化 → 发 zoray.fuchouzhiling', () => {
    const g: GameState = createGame({ seed: 1, firstPlayer: 'A', heroA: ['025', '026', '027'], heroB: ['001', '002', '003'], legendA: 'L05' });
    skipInitialReroll(g);
    g.players.A.life = 35;
    g.players.A.lifeTens = 4; // 强制"十位数变化"
    fxReset();
    checkLifeTens(g, 'A');
    expect(firedKey('zoray.fuchouzhiling')).toBe(true);
  });
});

describe('额外操作事件 · T11 迷烟（首回合多给重掷阶段时弹）', () => {
  it('首回合给重掷阶段 → 发 tacticFired T11', () => {
    const g: GameState = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'], tacticA: 'T11' });
    skipInitialReroll(g);
    g.activePlayer = 'A';
    g.firstRound['A'] = true;
    g.phase = 'main';
    fxReset();
    beginTurn(g);
    expect(fxTake()).toContainEqual({ kind: 'tacticFired', player: 'A', tacticId: 'T11' });
  });
});

describe('额外操作事件 · L08 没有怜悯 → 凶弹业舞（顺序：没有怜悯在前）', () => {
  it('024 必杀经「没有怜悯」发动 → 先发 meiyoulianmin、后发 kuangwu.ultimate', () => {
    const g: GameState = createGame({ seed: 1, firstPlayer: 'A', heroA: ['022', '023', '024'], heroB: ['001', '002', '003'], legendA: 'L08' });
    skipInitialReroll(g);
    let guard = 0;
    while (g.phase !== 'main' && g.phase !== 'gameOver' && guard++ < 12) applyAction(g, { t: 'advance' });
    const a024 = g.players.A.artifacts.find((a) => a.id === '024')!;
    a024.chargeLayer = a024.chargeReq ?? 0;
    a024.activeMarkerSide = 'left';
    g.dustfall = 4;
    fxReset();
    applyAction(g, { t: 'skill', artifactId: '024', side: 'only', params: { groups: [[], [], [], [], [], []], direction: 'cw' } });
    const fired = fxTake()
      .filter((e) => e.kind === 'skillFired')
      .map((e) => e.skillKey);
    expect(fired).toContain('xiva.meiyoulianmin');
    expect(fired).toContain('kuangwu.ultimate');
    expect(fired.indexOf('xiva.meiyoulianmin')).toBeLessThan(fired.indexOf('kuangwu.ultimate'));
  });
});

const firedKeys = (): string[] =>
  fxTake()
    .filter((e) => e.kind === 'skillFired')
    .map((e) => e.skillKey ?? '');

describe('联合发动 · L01 断苇一斩 × 斩神切（同动作一起弹）', () => {
  const toMain = (g: GameState): void => {
    let guard = 0;
    while (g.phase !== 'main' && g.phase !== 'gameOver' && guard++ < 12) applyAction(g, { t: 'advance' });
  };
  const setup = (): GameState => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'], legendA: 'L01' });
    skipInitialReroll(g);
    toMain(g);
    const a003 = g.players.A.artifacts.find((a) => a.id === '003')!;
    a003.chargeLayer = a003.chargeReq ?? 0;
    a003.activeMarkerSide = 'left';
    g.players.A.noDamageLastTurn = true;
    return g;
  };
  it('选「断苇一斩」变体 → 先断苇一斩、再斩神切', () => {
    const g = setup();
    fxReset();
    applyAction(g, { t: 'skill', artifactId: '003', side: 'only', params: { opponentDiscardAll: true } });
    const fired = firedKeys();
    expect(fired).toContain('kong.duanweiyizhan');
    expect(fired).toContain('mingjing.ultimate');
    expect(fired.indexOf('kong.duanweiyizhan')).toBeLessThan(fired.indexOf('mingjing.ultimate'));
  });
  it('普通斩神切（无 opponentDiscardAll）→ 不发断苇一斩', () => {
    const g = setup();
    fxReset();
    applyAction(g, { t: 'skill', artifactId: '003', side: 'only' });
    const fired = firedKeys();
    expect(fired).not.toContain('kong.duanweiyizhan');
    expect(fired).toContain('mingjing.ultimate');
  });
});

describe('联合发动 · L08 蛇蝎之泪 × 填弹（同动作一起弹）', () => {
  it('发动填弹 → 同时发 xiva.shexiezhilei', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['022', '023', '024'], heroB: ['004', '005', '006'], legendA: 'L08' });
    skipInitialReroll(g);
    let guard = 0;
    while (g.phase !== 'main' && g.phase !== 'gameOver' && guard++ < 12) applyAction(g, { t: 'advance' });
    const a022 = g.players.A.artifacts.find((a) => a.id === '022')!;
    a022.activeMarkerSide = 'left';
    a022.armedSide = 'left';
    a022.armedTurn = g.turnIndex;
    g.players.A.areas.meditation = [{ id: 'tt', value: 3, kind: 'meditation' }];
    fxReset();
    applyAction(g, { t: 'skill', artifactId: '022', side: 'left', params: { dieIds: ['tt'] } });
    expect(firedKeys()).toContain('xiva.shexiezhilei');
  });
});

describe('联合发动 · L08 只为赏金而来 × 被授予的启动（同动作一起弹）', () => {
  it('经只为赏金而来启动技能 → 先只为赏金而来、再技能名', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['022', '023', '024'], heroB: ['004', '005', '006'], legendA: 'L08' });
    skipInitialReroll(g);
    let guard = 0;
    while (g.phase !== 'main' && g.phase !== 'gameOver' && guard++ < 12) applyAction(g, { t: 'advance' });
    const a022 = g.players.A.artifacts.find((a) => a.id === '022')!;
    a022.activeMarkerSide = 'left';
    a022.armedSide = 'left';
    a022.armedTurn = g.turnIndex;
    g.players.A.areas.meditation = [{ id: 'tt', value: 3, kind: 'meditation' }];
    g.pending = { kind: 'shangjin', player: 'A' };
    fxReset();
    applyAction(g, { t: 'skill', artifactId: '022', side: 'left', params: { dieIds: ['tt'] } });
    const fired = firedKeys();
    expect(fired).toContain('xiva.zhiweishangjin');
    expect(fired).toContain('siji.tiandan');
    expect(fired.indexOf('xiva.zhiweishangjin')).toBeLessThan(fired.indexOf('siji.tiandan'));
  });
});

describe('顺序发动 · L03 拔城（点「发动拔城」才弹）', () => {
  const armed = (): GameState => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['007', '002', '003'], heroB: ['004', '005', '006'], legendA: 'L03' });
    skipInitialReroll(g);
    let guard = 0;
    while (g.phase !== 'main' && g.phase !== 'gameOver' && guard++ < 12) applyAction(g, { t: 'advance' });
    g.pending = { kind: 'bacheng', player: 'A' };
    return g;
  };
  it('accept:true → 发 batton.bacheng', () => {
    const g = armed();
    fxReset();
    applyAction(g, { t: 'bacheng', accept: true });
    expect(firedKeys()).toContain('batton.bacheng');
  });
  it('accept:false → 不发', () => {
    const g = armed();
    fxReset();
    applyAction(g, { t: 'bacheng', accept: false });
    expect(firedKeys()).not.toContain('batton.bacheng');
  });
  it('accept:true → 补「切换」动效事件（主宰卡，mode switch）', () => {
    const g = armed();
    fxReset();
    applyAction(g, { t: 'bacheng', accept: true });
    const rise = fxTake().find((e) => e.kind === 'rise');
    expect(rise).toMatchObject({ kind: 'rise', player: 'A', artifactId: '007', mode: 'switch' });
  });
  it('accept:false → 无「切换」动效事件', () => {
    const g = armed();
    fxReset();
    applyAction(g, { t: 'bacheng', accept: false });
    expect(fxTake().some((e) => e.kind === 'rise')).toBe(false);
  });
});

describe('开局 · L03 无敌（首帧弹一次）', () => {
  it('createGame(legendA:L03) → 建局即含 batton.wudi 事件', () => {
    fxReset();
    createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'], legendA: 'L03' });
    expect(firedKeys()).toContain('batton.wudi');
  });
});
