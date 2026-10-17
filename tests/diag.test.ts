import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  diag,
  diagClear,
  diagCount,
  diagDump,
  setDiagEnabled,
  isDiagEnabled,
  missingDiceInDom,
  challengeSnapshot,
} from '../src/ui/diag';
import { createChallengeGame } from '../src/core/engine/game';

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

  it('challengeSnapshot：含双方三区（id:点数）、传奇卡、待决策/攻击队列', () => {
    const g = createChallengeGame({ seed: 1, cardId: 'Z09', challenger: ['001', '002', '003'] });
    g.players.B.areas.attack = [{ id: 'bx', value: 3, kind: 'attack' }];
    g.pending = { kind: 'tiaolingPick', player: 'A', owner: 'B' };
    const s = challengeSnapshot(g) as Record<string, unknown>;
    expect(s.mode).toBe('challenge');
    expect(s.card).toBe('Z09');
    expect((s.B as { attack: string[] }).attack).toEqual(['bx:3']);
    expect(s.pending).toBe('tiaolingPick');
    expect(s.pendingPlayer).toBe('A');
  });
});
