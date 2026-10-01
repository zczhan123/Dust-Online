// 战术牌 T07「保守」/ T08「无情」
import { describe, it, expect } from 'vitest';
import { createGame, applyAction, beginTurn, skipInitialReroll } from '../src/core/engine/game';
import { resetToBattleStart } from '../src/core/engine/reset';
import { TACTIC_POOL } from '../src/core/content/tactics';
import type { GameState } from '../src/core/model/types';

const mk = (tacticA: string, tacticB = 'T03'): GameState =>
  createGame({
    seed: 1,
    firstPlayer: 'A',
    heroA: ['001', '002', '003'],
    heroB: ['001', '002', '003'],
    tacticA,
    tacticB,
  });

describe('T08「无情」', () => {
  it('对方回合开始 + 任一方生命 ≤20 → 本回合玩家受 2 真伤', () => {
    const g = mk('T08'); // A 持 T08
    g.phase = 'main';
    g.activePlayer = 'B';
    g.players.A.life = 50;
    g.players.B.life = 20;
    beginTurn(g);
    expect(g.players.B.life).toBe(18);
  });

  it('条件是"任一方"：持有者自己生命 ≤20 也成立', () => {
    const g = mk('T08');
    g.phase = 'main';
    g.activePlayer = 'B';
    g.players.A.life = 20; // 持有者 A ≤20
    g.players.B.life = 50;
    beginTurn(g);
    expect(g.players.B.life).toBe(48);
  });

  it('双方都 >20 → 不触发', () => {
    const g = mk('T08');
    g.phase = 'main';
    g.activePlayer = 'B';
    g.players.A.life = 21;
    g.players.B.life = 50;
    beginTurn(g);
    expect(g.players.B.life).toBe(50);
  });

  it('持有者自己的回合开始 → 不触发（只认"对方的回合"）', () => {
    const g = mk('T08'); // A 持 T08
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.A.life = 10;
    g.players.B.life = 50;
    beginTurn(g);
    expect(g.players.A.life).toBe(10);
  });

  it('每个对方回合都可再次触发', () => {
    const g = mk('T08');
    g.phase = 'main';
    g.activePlayer = 'B';
    g.players.A.life = 50;
    g.players.B.life = 20;
    beginTurn(g);
    g.activePlayer = 'B';
    beginTurn(g);
    expect(g.players.B.life).toBe(16); // 两次各 −2
  });
});

describe('T07「保守」', () => {
  it('从第 1 回合起，防御骰第一次为 0 → +1 防御骰 +1 冥想骰，且整局只一次', () => {
    const g = mk('T07'); // A 持 T07
    skipInitialReroll(g);
    expect(g.turnIndex).toBeGreaterThanOrEqual(1);

    const medBefore = g.players.A.areas.meditation.length;
    g.players.A.areas.defense = []; // 防御骰第一次为 0
    applyAction(g, { t: 'advance' }); // 行动结算后检查
    expect(g.players.A.areas.defense).toHaveLength(1);
    expect(g.players.A.areas.meditation.length).toBe(medBefore + 1);
    expect(g.players.A.tacticOnceUsed).toBe(true);

    // 再次归 0 → 不再触发
    const med2 = g.players.A.areas.meditation.length;
    g.players.A.areas.defense = [];
    applyAction(g, { t: 'advance' });
    expect(g.players.A.areas.defense).toHaveLength(0);
    expect(g.players.A.areas.meditation.length).toBe(med2);
  });

  it('L04 重开清零 → 可再次触发', () => {
    const g = mk('T07');
    skipInitialReroll(g);
    g.players.A.tacticOnceUsed = true;
    resetToBattleStart(g, 'A');
    expect(g.players.A.tacticOnceUsed).toBe(false);
  });
});

describe('战术牌池含 T07/T08', () => {
  it('TACTIC_POOL 含 T07 与 T08', () => {
    expect(TACTIC_POOL).toContain('T07');
    expect(TACTIC_POOL).toContain('T08');
  });
});
