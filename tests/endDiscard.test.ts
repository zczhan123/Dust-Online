import { describe, it, expect } from 'vitest';
import { createGame, applyAction, skipInitialReroll } from '../src/core/engine/game';
import { effectiveWill, totalDice } from '../src/core/engine/derive';
import type { GameState } from '../src/core/model/types';

const toMain = (g: GameState): void => {
  let n = 0;
  while (g.phase !== 'main' && g.phase !== 'gameOver' && n++ < 12) applyAction(g, { t: 'advance' });
};

/** A 进入主要阶段，并布置为「总数 = 意志 + 1」（攻击 1 + 防御 1 + 冥想(意志-1)） */
const overWill = (): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A' });
  skipInitialReroll(g);
  toMain(g);
  const p = g.players.A;
  const will = effectiveWill(p);
  p.areas.attack = [{ id: 'a1', value: 1, kind: 'attack' }];
  p.areas.defense = [{ id: 'd1', value: 2, kind: 'defense' }];
  p.areas.meditation = [];
  for (let i = 0; i < will - 1; i++) p.areas.meditation.push({ id: `m${i}`, value: 3, kind: 'meditation' });
  return g;
};

describe('结束阶段：超出意志上限 → 由玩家自选弃骰（说明书 page_09）', () => {
  it('弹出 endDiscard；选「攻击骰」后只弃这些、总数=意志（保留冥想）', () => {
    const g = overWill();
    const will = effectiveWill(g.players.A);
    expect(totalDice(g.players.A)).toBe(will + 1);
    applyAction(g, { t: 'advance' }); // main → end
    expect(g.pending?.kind).toBe('endDiscard');
    expect(g.pending && g.pending.kind === 'endDiscard' ? g.pending.player : null).toBe('A');
    // 玩家显式选择弃「攻击骰 a1」（而非引擎默认的冥想优先）
    applyAction(g, { t: 'endDiscardResolve', dieIds: ['a1'] });
    expect(g.pending).toBeNull();
    expect(g.players.A.areas.attack.some((d) => d.id === 'a1')).toBe(false);
    expect(g.players.A.areas.meditation.length).toBe(will - 1); // 冥想未被弃
    expect(totalDice(g.players.A)).toBe(will);
  });

  it('未超上限 → 不弹选择器，直接结束回合', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(g);
    toMain(g);
    expect(totalDice(g.players.A)).toBe(effectiveWill(g.players.A)); // 初始 = 意志
    applyAction(g, { t: 'advance' });
    expect(g.pending?.kind ?? null).not.toBe('endDiscard');
  });

  it('数量不对 → 抛错且不改变状态（非法不落状态）', () => {
    const g = overWill();
    applyAction(g, { t: 'advance' });
    const before = totalDice(g.players.A);
    expect(() => applyAction(g, { t: 'endDiscardResolve', dieIds: ['a1', 'd1'] })).toThrow();
    expect(totalDice(g.players.A)).toBe(before);
    expect(g.pending?.kind).toBe('endDiscard'); // 未解算成功
  });
});
