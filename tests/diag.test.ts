import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  diag,
  diagClear,
  diagCount,
  diagDump,
  setDiagEnabled,
  isDiagEnabled,
  missingDiceInDom,
  gameSnapshot,
  snapshotForState,
  staleDice,
} from '../src/ui/diag';
import { applyAction, createGame, createChallengeGame, createTwoVTwoGame } from '../src/core/engine/game';

beforeEach(() => setDiagEnabled(true));
afterEach(() => setDiagEnabled(false));

describe('排查用诊断日志（?diag=1）', () => {
  it('关闭时不记录，开启时才记录（默认零开销）', () => {
    setDiagEnabled(false);
    expect(isDiagEnabled()).toBe(false);
    diag('x', { a: 1 });
    expect(diagCount()).toBe(0);
    setDiagEnabled(true);
    diag('x', { a: 1 });
    expect(diagCount()).toBe(1);
    expect(diagDump()).toContain('x {"a":1}');
  });

  it('环形缓冲封顶 800 条（保留最新的）', () => {
    for (let i = 0; i < 850; i++) diag('n', { i });
    expect(diagCount()).toBe(800);
    const dump = diagDump();
    expect(dump).toContain('{"i":849}');
    expect(dump).not.toContain('{"i":49}');
  });

  it('清空', () => {
    diag('a');
    diagClear();
    expect(diagCount()).toBe(0);
    expect(diagDump()).toBe('');
  });

  it('missingDiceInDom：数据里有、画面上没有（重复 id 只报一次）', () => {
    expect(missingDiceInDom(['a', 'b', 'c'], ['a', 'c'])).toEqual(['b']);
    expect(missingDiceInDom(['a', 'a', 'b'], ['a'])).toEqual(['b']);
    expect(missingDiceInDom(['a', 'b'], ['a', 'b', 'zz'])).toEqual([]);
  });

  it('gameSnapshot：含双方三区（id:点数）、传奇卡、待决策/攻击队列', () => {
    const g = createChallengeGame({ seed: 1, cardId: 'Z09', challenger: ['001', '002', '003'] });
    g.players.B.areas.attack = [{ id: 'bx', value: 3, kind: 'attack' }];
    g.pending = { kind: 'tiaolingPick', player: 'A', owner: 'B' };
    const s = gameSnapshot(g) as Record<string, unknown>;
    expect(s.mode).toBe('challenge');
    expect(s.card).toBe('Z09');
    expect((s.B as { attack: string[] }).attack).toEqual(['bx:3']);
    expect(s.pending).toBe('tiaolingPick');
    expect(s.pendingPlayer).toBe('A');
  });

  it('gameSnapshot（标准模式）：挑战专属字段为 null，双方区域骰照常记录', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] });
    g.players.A.areas.attack = [{ id: 'a1', value: 4, kind: 'attack' }];
    g.players.B.areas.defense = [{ id: 'b1', value: 2, kind: 'defense' }];
    const s = gameSnapshot(g) as Record<string, unknown>;
    expect(s.mode).toBe('standard');
    expect(s.card).toBeNull();
    expect(s.driven).toBeNull();
    expect(s.legendTurn).toBeNull();
    expect((s.A as { attack: string[] }).attack).toEqual(['a1:4']);
    expect((s.B as { defense: string[] }).defense).toEqual(['b1:2']);
  });

  it('gameSnapshot 带 gone（隐藏名单快照）', () => {
    const g = createChallengeGame({ seed: 1, cardId: 'Z09', challenger: ['001', '002', '003'] });
    expect((gameSnapshot(g, ['x1']) as Record<string, unknown>).gone).toEqual(['x1']);
  });

  it('2v2 快照：不碰 players.A/B，记录四座位与团队生命', () => {
    const g = createTwoVTwoGame({
      seats: {
        A1: ['001', '002', '003'],
        A2: ['004', '005', '006'],
        B1: ['007', '008', '009'],
        B2: ['010', '011', '012'],
      },
      firstTeam: 'A',
      seed: 7,
    });
    g.stance = 'defensePicks';
    g.teams!.B.life = 73;
    const s = snapshotForState(g, ['x1']) as Record<string, unknown>;
    expect(s.mode).toBe('2v2');
    expect(s.stance).toBe('defensePicks');
    expect(s.gone).toEqual(['x1']);
    expect(s.teams).toMatchObject({ B: { life: 73 } });
    expect(Object.keys(s.seats as Record<string, unknown>)).toEqual(['A1', 'B1', 'A2', 'B2']);
    expect((s.seats as Record<string, { areas: { attack: string[] } }>).A1.areas.attack).toBeDefined();
    expect(Array.isArray(s.logTail)).toBe(true);
  });

  it('2v2 重掷后生成快照不抛异常', () => {
    const g = createTwoVTwoGame({
      seats: {
        A1: ['001', '002', '003'],
        A2: ['004', '005', '006'],
        B1: ['007', '008', '009'],
        B2: ['010', '011', '012'],
      },
      firstTeam: 'A',
      seed: 7,
      dice: { A1: { attack: [1, 2], defense: [3], meditation: [4] } },
    });
    g.phase = 'reroll';
    g.activePlayer = 'A1';
    g.rerollUsed = 0;
    const ids = (['attack', 'defense', 'meditation'] as const)
      .flatMap((kind) => g.players.A1.areas[kind])
      .map((d) => d.id);
    applyAction(g, { t: 'reroll', dieIds: ids });
    expect(() => snapshotForState(g)).not.toThrow();
    expect((snapshotForState(g) as Record<string, unknown>).mode).toBe('2v2');
  });

  it('staleDice：画面值与数据值不一致（过时骰子）', () => {
    expect(staleDice({ a: 4, b: 5 }, { a: '5', b: '5', c: '3' })).toEqual([{ id: 'a', data: 4, dom: '5' }]);
  });
});
