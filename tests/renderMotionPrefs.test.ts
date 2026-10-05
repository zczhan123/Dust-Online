import { describe, it, expect, beforeEach } from 'vitest';
import { createGame } from '../src/core/engine/game';
import { renderGame, type RenderHooks, type UiState } from '../src/ui/render';
import { DEFAULT_PREFS, clonePrefs, loadPrefs, savePrefs, speedOf } from '../src/ui/prefs';
import type { Prefs } from '../src/ui/prefs';

describe('prefs · 动画速度（animSpeed）', () => {
  beforeEach(() => localStorage.clear());

  it('缺省 = 正常（speedOf=1）', () => {
    const p = loadPrefs();
    expect(p.animSpeed).toBeUndefined();
    expect(speedOf(p.animSpeed)).toBe(1);
    expect(speedOf('normal')).toBe(1);
    expect(speedOf('fast')).toBe(2);
  });

  it('save → load 往返保留 fast', () => {
    savePrefs({ ...clonePrefs(DEFAULT_PREFS), animSpeed: 'fast' });
    expect(loadPrefs().animSpeed).toBe('fast');
  });

  it('非法值被忽略（回退缺省）', () => {
    localStorage.setItem('dust.prefs.v1', JSON.stringify({ animSpeed: 'turbo' }));
    expect(loadPrefs().animSpeed).toBeUndefined();
  });
});

describe('设置面板 · 动画速度入口', () => {
  const mount = () => {
    const root = document.createElement('div');
    const state = createGame({ seed: 1, firstPlayer: 'A' });
    const ui: UiState = {
      rerollSelected: new Set(),
      selection: null,
      pendingConfirm: null,
      convertPick: null,
      fengmangPick: null,
      hanguangPick: null,
      quanzhi: null,
      dustFlow: null,
      prefs: clonePrefs(DEFAULT_PREFS),
      settingsOpen: false,
      logOpen: false,
      logPop: false,
      detail: null,
      error: null,
    };
    const saved: Prefs[] = [];
    const hooks: RenderHooks = {
      ui,
      onAction: () => {},
      propose: () => {},
      requestRender: () => renderGame(state, root, hooks),
      onRestart: () => {},
      onPrefsChange: (p) => saved.push(p),
    };
    renderGame(state, root, hooks);
    (root.querySelector<HTMLButtonElement>('.btn-settings')!).click();
    const opt = (text: string): HTMLButtonElement =>
      Array.from(root.querySelectorAll<HTMLButtonElement>('.settings-row .settings-opt')).find(
        (b) => b.textContent === text,
      )!;
    return { ui, saved, opt };
  };

  it('点「快」写入 animSpeed=fast，且不把预设变成自定义', () => {
    const { ui, saved, opt } = mount();
    opt('快').click();
    expect(ui.prefs.animSpeed).toBe('fast');
    expect(saved[saved.length - 1].animSpeed).toBe('fast');
    expect(ui.prefs.preset).toBe('desktop');
  });

  it('切换预设组合不会重置动画速度', () => {
    const { ui, opt } = mount();
    opt('快').click();
    opt('触屏模式').click();
    expect(ui.prefs.preset).toBe('touch');
    expect(ui.prefs.animSpeed).toBe('fast');
  });
});
