// L11「受缚邪灵」艾娃 界面：面板三行技能、计数上限 99 徽标（L07 之后第二个"面板计数"）
import { describe, it, expect } from 'vitest';
import { setupGame } from '../src/core/engine/setup';
import { renderGame, type RenderHooks, type UiState } from '../src/ui/render';
import type { Action, GameState } from '../src/core/model/types';

const makeUi = (): UiState => ({
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

const mount = (state: GameState): { root: HTMLElement; acts: Action[] } => {
  const root = document.createElement('div');
  const acts: Action[] = [];
  const hooks: RenderHooks = {
    onAction: (a) => {
      acts.push(a);
      renderGame(state, root, hooks);
    },
    ui: makeUi(),
    propose: (a) => {
      acts.push(a);
      renderGame(state, root, hooks);
    },
    requestRender: () => renderGame(state, root, hooks),
    onRestart: () => {},
  };
  renderGame(state, root, hooks);
  return { root, acts };
};

const l11 = (): GameState =>
  setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L11', heroA: ['031', '032', '033'], heroB: ['004', '005', '006'] });

describe('L11 受缚邪灵 艾娃 · 面板 UI', () => {
  it('面板三行技能 key 精确对应', () => {
    const g = l11();
    g.phase = 'main';
    g.activePlayer = 'A';
    const keys = Array.from(
      mount(g).root.querySelectorAll('.card-legend[data-legend="L11"] .skill-part'),
    ).map((p) => (p as HTMLElement).dataset.key);
    expect(keys).toEqual(['aiwa.qiangjiazhiuzui', 'aiwa.xielingxuqu', 'aiwa.yonghengnvwang']);
  });

  it('计数徽标：上限 99，从 0 起就显示「计数 N/99」', () => {
    const g = l11();
    g.phase = 'main';
    g.activePlayer = 'A';
    const badge = (): string =>
      mount(g).root.querySelector('.card-legend[data-legend="L11"] .badge-count')?.textContent ?? '';
    expect(badge()).toBe('计数 0/99');
    g.players.A.legend!.count = 12;
    expect(badge()).toBe('计数 12/99');
  });

  it('永恒女王用过后该行转深灰（整局一次已用）；其余行不受影响', () => {
    const g = l11();
    g.phase = 'main';
    g.activePlayer = 'A';
    g.legendOnceUsed.push('A:aiwa.yonghengnvwang');
    const { root } = mount(g);
    const partOf = (key: string): HTMLElement =>
      root.querySelector<HTMLElement>(`.card-legend[data-legend="L11"] .skill-part[data-key="${key}"]`)!;
    expect(partOf('aiwa.yonghengnvwang').classList.contains('skill-part--disabled')).toBe(true);
    expect(partOf('aiwa.qiangjiazhiuzui').classList.contains('skill-part--disabled')).toBe(false);
  });
});
