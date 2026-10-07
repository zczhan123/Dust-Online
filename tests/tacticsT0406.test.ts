// 战术牌 T04「末路」/ T05「狂热」/ T06「残忍」
import { describe, it, expect } from 'vitest';
import { createGame, applyAction, beginTurn, skipInitialReroll, tacticBarState } from '../src/core/engine/game';
import { pumpPending } from '../src/core/engine/pending';
import { tacticActiveBonus, applyMolu } from '../src/core/engine/combat';
import type { GameState, PlayerId } from '../src/core/model/types';

const reqOf = (g: GameState, who: PlayerId): number =>
  g.players[who].artifacts.find((a) => a.column === 3)?.chargeReq ?? 0;

describe('T04「末路」：启动必杀式后 → 造成/回复＝第三列充能需求', () => {
  it('applyMolu：对对方造成 req 真实伤害、自己回复 req 生命', () => {
    const g = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['001', '002', '003'],
      heroB: ['001', '002', '003'],
      tacticA: 'T04',
      tacticB: 'T03',
    });
    g.phase = 'main';
    const req = reqOf(g, 'A');
    expect(req).toBeGreaterThan(0);
    g.players.A.life = 20;
    g.players.A.lifeMax = 50;
    g.players.B.life = 40;
    applyMolu(g, 'A');
    expect(g.players.B.life).toBe(40 - req);
    expect(g.players.A.life).toBe(20 + req);
  });

  it('未持有 T04 → 无效果', () => {
    const g = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['001', '002', '003'],
      heroB: ['001', '002', '003'],
      tacticA: 'T05',
      tacticB: 'T03',
    });
    g.players.B.life = 40;
    applyMolu(g, 'A');
    expect(g.players.B.life).toBe(40);
  });

  it('启动必杀式（L02「藏地花」）→ 触发 T04', () => {
    const g = createGame({
      seed: 1,
      firstPlayer: 'A',
      legendA: 'L02',
      heroA: ['001', '002', '003'],
      heroB: ['001', '002', '003'],
      tacticA: 'T04',
      tacticB: 'T03',
    });
    const req = reqOf(g, 'A');
    g.dustfall = 1;
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.A.life = 20;
    g.players.A.lifeMax = 50;
    g.players.B.life = 40;
    applyAction(g, { t: 'skill', artifactId: 'L02', side: 'only', params: {} });
    expect(g.players.B.life).toBe(40 - req);
    expect(g.players.A.life).toBe(20 + req);
  });

  it('018「漆黑绽放」强制发动必杀 → 也触发 T04', () => {
    const g = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['001', '002', '018'],
      heroB: ['001', '002', '003'],
      tacticA: 'T04',
      tacticB: 'T03',
    });
    const req = reqOf(g, 'A'); // 018 为第三列
    expect(req).toBeGreaterThan(0);
    g.players.A.life = 20;
    g.players.A.lifeMax = 50;
    g.players.B.life = 40;
    const c = g.players.A.artifacts.find((a) => a.id === '018')!;
    c.activeMarkerSide = 'left';
    c.armedSide = 'left';
    c.armedTurn = g.turnIndex;
    c.count = 5;
    pumpPending(g);
    expect(g.pending?.kind).toBe('zhihaiReroll');
    expect(g.players.B.life).toBe(40 - req);
    expect(g.players.A.life).toBe(20 + req);
  });
});

describe('T05「狂热」：自己前 3 个回合攻击伤害 +1', () => {
  it('tacticActiveBonus：自己回合且第 1–3 个回合 → +1；第 4 个回合 / 非自己回合 → 无', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], tacticA: 'T05', tacticB: 'T03' });
    skipInitialReroll(g);
    g.phase = 'main';
    g.activePlayer = 'A';
    for (const n of [1, 2, 3]) {
      g.players.A.turnsTaken = n;
      expect(tacticActiveBonus(g, 'A')).toEqual({ label: '狂热', value: 1 });
    }
    g.players.A.turnsTaken = 4;
    expect(tacticActiveBonus(g, 'A')).toBeNull();
    g.players.A.turnsTaken = 2; // 非自己回合
    g.activePlayer = 'B';
    expect(tacticActiveBonus(g, 'A')).toBeNull();
  });

  it('beginTurn：该玩家回合计数 +1，封顶 4', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], tacticA: 'T05', tacticB: 'T03' });
    skipInitialReroll(g);
    expect(g.players.A.turnsTaken).toBe(1); // 首回合
    g.players.A.turnsTaken = 0;
    g.activePlayer = 'A';
    for (let i = 0; i < 8; i++) beginTurn(g);
    expect(g.players.A.turnsTaken).toBe(4); // 封顶
  });

  it('tacticBarState：前 3 回合内**不看是否自己回合**都「生效中」；第 4 回合转「已用尽」', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], tacticA: 'T05', tacticB: 'T03' });
    skipInitialReroll(g);
    g.players.A.turnsTaken = 2;
    g.activePlayer = 'A';
    expect(tacticBarState(g, 'A')).toBe('active');
    g.activePlayer = 'B'; // 对方回合也不闪灰
    expect(tacticBarState(g, 'A')).toBe('active');
    g.players.A.turnsTaken = 4;
    expect(tacticBarState(g, 'A')).toBe('spent');
  });
});

describe('T06「残忍」：对方生命 ≤13 时攻击伤害 +5', () => {
  it('tacticActiveBonus：13 → +5；14 → 无', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], tacticA: 'T06', tacticB: 'T03' });
    skipInitialReroll(g);
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.B.life = 13;
    expect(tacticActiveBonus(g, 'A')).toEqual({ label: '残忍', value: 5 });
    g.players.B.life = 14;
    expect(tacticActiveBonus(g, 'A')).toBeNull();
  });

  it('实际攻击：对方生命 13 → 本次伤害 +5（E2E，2 点攻击骰 → 扣 7）', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], tacticA: 'T06', tacticB: 'T03' });
    skipInitialReroll(g);
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.B.life = 13;
    g.players.A.areas.attack = [{ id: 'a1', value: 2, kind: 'attack' }];
    g.players.B.areas.defense = [];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    expect(g.pendingAttack?.value).toBe(7); // 2 + 5
    applyAction(g, { t: 'block' }); // 不抵挡
    expect(g.players.B.life).toBe(13 - 7);
  });
});
