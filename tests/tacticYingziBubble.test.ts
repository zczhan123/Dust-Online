import { describe, it, expect } from 'vitest';
import { applyAction, createGame, skipInitialReroll } from '../src/core/engine/game';
import { fxReset, fxTake } from '../src/core/engine/fx';
import type { Pending } from '../src/core/model/types';

describe('T15「影子」置骰 → 弹 tacticFired 气泡', () => {
  it('yingziPick 放置存放骰 → 发一条 tacticFired（T15）', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(g);
    g.players.A.tactic = 'T15';
    g.pending = { kind: 'yingziPick', player: 'A' } as Pending;
    fxReset();
    applyAction(g, { t: 'yingziPick', value: 5 });
    expect(g.players.A.tacticHeldDie?.value).toBe(5);
    expect(fxTake()).toContainEqual({ kind: 'tacticFired', player: 'A', tacticId: 'T15' });
  });
});
