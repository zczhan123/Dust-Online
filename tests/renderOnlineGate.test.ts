import { describe, it, expect, afterEach } from 'vitest';
import { createGame, skipInitialReroll } from '../src/core/engine/game';
import { renderGame, setLocalViewPlayer, type RenderHooks, type UiState, type OnlineUi } from '../src/ui/render';
import { DEFAULT_PREFS, clonePrefs } from '../src/ui/prefs';
import type { GameState, PlayerId } from '../src/core/model/types';

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

const onlineUi = (myPlayer: PlayerId): OnlineUi => ({
  myPlayer,
  names: { A: '阿尘', B: '小明' },
  onLeaveLobby: () => {},
});

const mount = (state: GameState, online?: OnlineUi): HTMLElement => {
  const root = document.createElement('div');
  const hooks: RenderHooks = {
    ui: makeUi(),
    onAction: () => {},
    propose: () => {},
    requestRender: () => {},
    onRestart: () => {},
    ...(online ? { online } : {}),
  };
  renderGame(state, root, hooks);
  return root;
};

afterEach(() => setLocalViewPlayer(null));

/** 造一个"轮到 `turn` 的主要阶段、无待决策"的局面 */
const newGame = (turn: PlayerId): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A' });
  skipInitialReroll(g);
  g.phase = 'main';
  g.pending = null;
  g.pendingAttack = null;
  g.activePlayer = turn;
  return g;
};

describe('联机·非本人操作 → 全面只读门禁（左右互搏不受影响）', () => {
  it('非本人（本机A、轮到B）：操作区只读，无操作按钮 / 无可点骰 / 无技能入口', () => {
    const g = newGame('B');
    setLocalViewPlayer('A');
    const root = mount(g, onlineUi('A'));
    expect(root.querySelector('.actionlist-readonly')).not.toBeNull();
    expect(root.querySelector('.actionzone .btn')).toBeNull();
    expect(root.querySelector('.die.clickable')).toBeNull();
    expect(root.querySelector('[data-act="skill"]')).toBeNull();
  });

  it('本人（本机B、轮到B）：正常交互（无只读说明）', () => {
    const g = newGame('B');
    setLocalViewPlayer('B');
    const root = mount(g, onlineUi('B'));
    expect(root.querySelector('.actionlist-readonly')).toBeNull();
  });

  it('左右互搏（无 online）：不出现只读说明（原路径不变）', () => {
    const g = newGame('B');
    setLocalViewPlayer(null);
    const root = mount(g);
    expect(root.querySelector('.actionlist-readonly')).toBeNull();
  });

  it('战前 抽2留1（非本人）：显示等待层、不显示对方牌面', () => {
    const g = newGame('B');
    skipInitialReroll(g);
    g.phase = 'tactics';
    g.activePlayer = 'B';
    g.tacticQueue = ['B'];
    g.pending = null;
    g.pendingAttack = null;
    setLocalViewPlayer('A');
    const root = mount(g, onlineUi('A'));
    expect(root.querySelector('.tactic-choose-modal--wait')).not.toBeNull();
    expect(root.querySelector('.tactic-choose-card')).toBeNull();
  });
});
