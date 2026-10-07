import { describe, it, expect, vi } from 'vitest';
import { createGame, createChallengeGame } from '../src/core/engine/game';
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
  prefs: {
    showSkillText: false,
    cardArt: 'thumb',
    density: 'compact',
    mirrorEnemy: false,
    preset: 'desktop',
    logCollapsed: false,
    zoomMode: 'off',
    zoomPercent: 90,
  },
  settingsOpen: false,
  logOpen: false,
  logPop: false,
  detail: null,
  error: null,
});

const mount = (state: GameState): { root: HTMLElement; ui: UiState } => {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  const ui = freshUi();
  const hooks: RenderHooks = {
    onAction: vi.fn(),
    ui,
    propose: () => {},
    requestRender: () => renderGame(state, root, hooks),
    onRestart: () => {},
  };
  renderGame(state, root, hooks);
  return { root, ui };
};

describe('挑战模式 · 战斗界面「特殊规则」入口', () => {
  it('挑战模式：设置旁出现「挑战模式特殊规则」按钮', () => {
    const { root } = mount(createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['001', '002', '003'] }));
    expect(root.querySelector('[data-act="challengeRulesOpen"]')).not.toBeNull();
    expect(root.querySelector('[data-act="settingsOpen"]')).not.toBeNull();
  });

  it('标准模式：不出现该按钮', () => {
    const { root } = mount(createGame({ seed: 1, firstPlayer: 'A' }));
    expect(root.querySelector('[data-act="challengeRulesOpen"]')).toBeNull();
  });

  it('点开后浮窗列出 5 条削弱（数据来自 CHALLENGE_RULE_NOTES）', () => {
    const state = createChallengeGame({ seed: 1, cardId: 'Z02', challenger: ['001', '002', '003'] });
    const { root, ui } = mount(state);
    (root.querySelector('[data-act="challengeRulesOpen"]') as HTMLElement).click();
    expect(ui.challengeRulesOpen).toBe(true);
    const text = root.textContent ?? '';
    for (const t of ['013 鸣雷·雷暴（持续）', '017 幽冥·帷幕', '028 天罚·白昼之火（含异相 A05）', '023 蛇蝎·共振', '020 兽魂']) {
      expect(text).toContain(t);
    }
    // 关闭
    (root.querySelector('[data-act="challengeRulesClose"]') as HTMLElement).click();
    expect(ui.challengeRulesOpen).toBe(false);
    expect(root.querySelector('[data-act="challengeRulesOverlay"]')).toBeNull();
  });
});
