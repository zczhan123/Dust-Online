import { describe, it, expect, afterEach } from 'vitest';
import { createGame, skipInitialReroll } from '../src/core/engine/game';
import { renderGame, setLocalViewPlayer, type RenderHooks, type UiState } from '../src/ui/render';
import { DEFAULT_PREFS, clonePrefs } from '../src/ui/prefs';
import type { GameState } from '../src/core/model/types';

const makeUi = (): UiState => ({
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
});

const mount = (state: GameState): HTMLElement => {
  const root = document.createElement('div');
  const hooks: RenderHooks = {
    ui: makeUi(),
    onAction: () => {},
    propose: () => {},
    requestRender: () => {},
    onRestart: () => {},
  };
  renderGame(state, root, hooks);
  return root;
};

afterEach(() => setLocalViewPlayer(null));

/** 把局面切到"轮到 B、无待决策"，用于测试"操作者变但视角是否变"。 */
const toTurnB = (g: GameState): void => {
  g.activePlayer = 'B';
  g.pending = null;
  g.pendingAttack = null;
  g.phase = 'main';
};

describe('联机固定视角（模拟）· "谁在下方"不随操作者切换', () => {
  it('联机（本机＝A）：即使轮到 B，self 面板恒为 A、enemy 恒为 B', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(g);
    setLocalViewPlayer('A');
    toTurnB(g);
    const root = mount(g);
    expect(root.querySelector('.player--self')!.getAttribute('data-player')).toBe('A');
    expect(root.querySelector('.player--enemy')!.getAttribute('data-player')).toBe('B');
  });

  it('左右互搏：self 面板＝当前操作者', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(g);
    setLocalViewPlayer(null);
    toTurnB(g);
    const root = mount(g);
    expect(root.querySelector('.player--self')!.getAttribute('data-player')).toBe('B');
  });
});
