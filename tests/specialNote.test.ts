import { describe, it, expect, vi } from 'vitest';
import { createGame } from '../src/core/engine/game';
import { SPECIAL_ARTIFACT_NOTE } from '../src/core/content/artifacts';
import { renderGame, setLocalViewPlayer, type RenderHooks, type UiState } from '../src/ui/render';
import { DEFAULT_PREFS, clonePrefs } from '../src/ui/prefs';
import type { GameState } from '../src/core/model/types';

/** A 持 C01（雨切·武士刀＝特典）/ 002 / 003；B 持 004/005/006。 */
function makeGame(): GameState {
  return createGame({ seed: 1, firstPlayer: 'A', heroA: ['C01', '002', '003'], heroB: ['004', '005', '006'] });
}

function mount(state: GameState, showSkillText: boolean): { root: HTMLElement; ui: UiState } {
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById('app')!;
  const ui: UiState = {
    rerollSelected: new Set(),
    selection: null,
    pendingConfirm: null,
    convertPick: null,
    fengmangPick: null,
    hanguangPick: null,
    quanzhi: null,
    dustFlow: null,
    prefs: { ...clonePrefs(DEFAULT_PREFS), showSkillText },
    settingsOpen: false,
    logOpen: false,
    logPop: false,
    detail: null,
    error: null,
  };
  const hooks: RenderHooks = {
    ui,
    onAction: vi.fn(),
    propose: () => {},
    requestRender: () => renderGame(state, root, hooks),
    onRestart: () => {},
  };
  setLocalViewPlayer('A'); // 只渲染"正在操作方"的卡 → 固定本机视角＝挑战者/本方 A
  renderGame(state, root, hooks);
  return { root, ui };
}

describe('特典神器（C01 雨切·武士刀）· 技能描述后的说明行', () => {
  it('文案唯一来源', () => {
    expect(SPECIAL_ARTIFACT_NOTE).toBe('仅供娱乐，本神器不能在正式比赛中使用');
  });

  it('战斗·显示技能描述时：C01 卡面有说明行；非特典没有', () => {
    try {
      const { root } = mount(makeGame(), true);
      expect(root.querySelector('[data-artifact="C01"] .card-special-note')?.textContent).toBe(SPECIAL_ARTIFACT_NOTE);
      expect(root.querySelector('[data-artifact="002"] .card-special-note')).toBeNull();
    } finally {
      setLocalViewPlayer(null);
    }
  });

  it('战斗·隐藏技能描述时（紧凑卡面）：不出现说明行', () => {
    try {
      const { root } = mount(makeGame(), false);
      expect(root.querySelector('[data-artifact="C01"] .card-special-note')).toBeNull();
    } finally {
      setLocalViewPlayer(null);
    }
  });

  it('战斗·右键详情浮窗：C01 有说明行；普通神器没有', () => {
    try {
      const g = makeGame();
      const { root, ui } = mount(g, false); // 卡面不带 → 出现的一定来自浮窗
      ui.detail = { artifactId: 'C01', player: 'A', rect: { left: 10, top: 10, width: 60, height: 90 } };
      renderGame(g, root, {
        ui,
        onAction: vi.fn(),
        propose: () => {},
        requestRender: () => {},
        onRestart: () => {},
      });
      expect(root.querySelector('.card-special-note')?.textContent).toBe(SPECIAL_ARTIFACT_NOTE);

      ui.detail = { artifactId: '002', player: 'A', rect: { left: 10, top: 10, width: 60, height: 90 } };
      root.innerHTML = '';
      renderGame(g, root, {
        ui,
        onAction: vi.fn(),
        propose: () => {},
        requestRender: () => {},
        onRestart: () => {},
      });
      expect(root.querySelector('.card-special-note')).toBeNull();
    } finally {
      setLocalViewPlayer(null);
    }
  });
});
