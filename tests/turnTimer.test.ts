import { describe, it, expect } from 'vitest';
import { applyAction, createGame, skipInitialReroll } from '../src/core/engine/game';
import { timeoutAction } from '../src/ui/turnTimer';
import type { GameState } from '../src/core/model/types';

const mk = (): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] });
  skipInitialReroll(g);
  g.phase = 'main';
  g.activePlayer = 'A';
  return g;
};

describe('行动倒计时 · 到点默认动作 timeoutAction', () => {
  it('阶段 → 结束当前阶段（advance）', () => {
    const g = mk();
    expect(timeoutAction(g)).toEqual({ t: 'advance' });
  });

  it('可放弃的待决策 → 放弃（bacheng accept:false），且可被引擎接受', () => {
    const g = mk();
    g.pending = { kind: 'bacheng', player: 'A' };
    const act = timeoutAction(g);
    expect(act).toEqual({ t: 'bacheng', accept: false });
    expect(() => applyAction(g, act)).not.toThrow();
  });

  it('待抵挡 → 不抵挡（block 无 costSlots），且可被引擎接受', () => {
    const g = mk();
    g.players.A.areas.attack = [{ id: 'a1', value: 3, kind: 'attack' }];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    expect(g.pendingAttack).toBeTruthy();
    const act = timeoutAction(g);
    expect(act.t).toBe('block');
    expect((act as { costSlots?: unknown[] }).costSlots ?? []).toEqual([]);
    expect(() => applyAction(g, act)).not.toThrow();
  });

  it('强制待决策（圆舞，无"不发动"）→ 引擎默认动作且合法', () => {
    const g = mk();
    g.players.A.areas.meditation = [{ id: 'm1', value: 5, kind: 'meditation' }];
    g.pending = { kind: 'yuanwu', player: 'A' };
    const act = timeoutAction(g);
    expect(() => applyAction(g, act)).not.toThrow();
  });
});
