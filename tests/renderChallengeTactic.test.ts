import { describe, it, expect, beforeEach } from 'vitest';
import { createChallengeGame } from '../src/core/engine/game';
import { renderGame, type RenderHooks, type UiState } from '../src/ui/render';
import type { GameState } from '../src/core/model/types';

const freshUi = (): UiState => ({
  rerollSelected: new Set(),
  selection: null,
  pendingConfirm: null,
  convertPick: null,
  fengmangPick: null,
  hanguangPick: null,
  quanzhi: null,
  dustFlow: null,
  prefs: { showSkillText: false, cardArt: 'thumb', density: 'compact', mirrorEnemy: false, preset: 'desktop', logCollapsed: false, zoomMode: 'off', zoomPercent: 90 },
  settingsOpen: false,
  logOpen: false,
  logPop: false,
  detail: null,
  error: null,
});

const mount = (state: GameState, root: HTMLElement): RenderHooks => {
  const hooks: RenderHooks = {
    onAction: () => {},
    ui: freshUi(),
    propose: () => {},
    requestRender: () => {},
    onRestart: () => {},
  };
  renderGame(state, root, hooks);
  return hooks;
};

describe('挑战模式 · 战术牌战前交互弹框（建局不经 tactics 阶段）', () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app')!;
  });

  it('T01 谨慎：挑战建局也弹「自定初始能力骰」', () => {
    const g = createChallengeGame({ seed: 1, cardId: 'Z01', challenger: ['001', '002', '003'], tactic: 'T01' });
    expect(g.phase).not.toBe('tactics');
    expect(g.pending?.kind).toBe('tacticDice');
    mount(g, root);
    expect(root.querySelector('.tactic-choose-overlay')).not.toBeNull();
    expect(root.querySelector('.tactic-dice-grid')).not.toBeNull();
    expect(root.textContent).toContain('谨慎');
  });

  it('T13 远见：挑战建局也弹「猜测玩家」', () => {
    const g = createChallengeGame({ seed: 1, cardId: 'Z01', challenger: ['001', '002', '003'], tactic: 'T13' });
    expect(g.pending?.kind).toBe('tacticGuess');
    mount(g, root);
    expect(root.querySelector('.tactic-choose-overlay')).not.toBeNull();
    expect(root.textContent).toContain('远见');
    expect(root.querySelectorAll('.tactic-first-card')).toHaveLength(2);
  });

  it('T02 先机：挑战下效果无效 → 不弹', () => {
    const g = createChallengeGame({ seed: 1, cardId: 'Z01', challenger: ['001', '002', '003'], tactic: 'T02' });
    mount(g, root);
    expect(root.querySelector('.tactic-choose-overlay')).toBeNull();
  });
});
