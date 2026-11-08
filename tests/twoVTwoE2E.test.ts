import { describe, it, expect, vi } from 'vitest';
import { renderSetup } from '../src/ui/setupScreen';
import { createTwoVTwoGame, getLegalActions } from '../src/core/engine/game';
import { render2v2Game } from '../src/ui/battle2v2View';
import { toMain } from './helpers';
import type { TwoVTwoSetup } from '../src/core/model/twoVTwo';

const finishDraft = (root: HTMLElement): void => {
  for (let i = 0; i < 12; i += 1) {
    const slot = root.querySelector<HTMLElement>('.pick-cards--4 .pick-slot.legal');
    if (!slot) break;
    slot.click();
  }
};

describe('2v2 最终链路', () => {
  it('团队作战入口 → 轮选 → 战斗 → 主要阶段可操作 → 结束弹窗', () => {
    document.body.innerHTML = '<div id="app"></div>';
    const root = document.getElementById('app')!;
    const started: { opts?: { twoVTwo?: TwoVTwoSetup } } = {};
    renderSetup(root, (opts) => { started.opts = opts as { twoVTwo?: TwoVTwoSetup }; });
    root.querySelector<HTMLElement>('.menu-item[data-act="jubai"]')!.click();
    root.querySelector<HTMLElement>('.menu-item[data-act="team2v2"]')!.click();
    root.querySelector<HTMLElement>('.pick-prep-chips .pick-tbtn')!.click();
    finishDraft(root);
    root.querySelector<HTMLButtonElement>('.assign-stage .assign-lock')!.click();
    root.querySelector<HTMLButtonElement>('.assign-stage .assign-lock')!.click();
    root.querySelector<HTMLButtonElement>('[data-act="start2v2"]')!.click();
    expect(started.opts?.twoVTwo).toBeTruthy();

    const state = createTwoVTwoGame({ ...started.opts!.twoVTwo!, seed: 1 });
    toMain(state);
    render2v2Game(root, state, { onAction: vi.fn(), onBack: vi.fn() });
    expect(root.querySelectorAll('.player[data-player]')).toHaveLength(4);
    expect(root.querySelectorAll('.card[data-artifact]')).toHaveLength(12);
    expect(getLegalActions(state).some((a) => a.t === 'attack')).toBe(true);

    state.phase = 'gameOver';
    state.winner = 'B';
    state.teams!.A.life = 0;
    render2v2Game(root, state, { onAction: vi.fn(), onBack: vi.fn() });
    expect(root.querySelector('.b2v2-gameover-winner')?.textContent).toBe('B 队胜利');
  });
});
