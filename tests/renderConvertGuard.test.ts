import { describe, it, expect } from 'vitest';
import { createGame, skipInitialReroll } from '../src/core/engine/game';
import { renderGame, type RenderHooks, type UiState } from '../src/ui/render';
import { DEFAULT_PREFS, clonePrefs } from '../src/ui/prefs';
import type { GameState } from '../src/core/model/types';

/** A 持 001/002/003；B 持 010/004/005，并把 B 的 010「真实之剑」激活（持续·左）。 */
function setup() {
  const root = document.createElement('div');
  const state: GameState = createGame({
    seed: 1,
    firstPlayer: 'A',
    heroA: ['001', '002', '003'],
    heroB: ['010', '004', '005'],
  });
  skipInitialReroll(state);
  state.players.B.artifacts.find((a) => a.id === '010')!.activeMarkerSide = 'left';
  // 保证 B 有 ≥2 颗能力骰（「置换抵挡」按钮需要）
  state.players.B.areas.attack.push(
    { id: 'bd1', value: 1, kind: 'attack' },
    { id: 'bd2', value: 2, kind: 'attack' },
  );
  // 造"待抵挡"：A 攻击 B
  state.pendingAttack = { attacker: 'A', value: 3, unblockable: false, physical: true };

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
  const hooks: RenderHooks = {
    ui,
    onAction: () => {},
    propose: () => {},
    requestRender: () => {},
    onRestart: () => {},
  };
  return { root, state, hooks };
}

describe('「置换抵挡」入口 · 待决策优先（修 resolve pending decision first）', () => {
  it('同时存在「待抵挡」与一个待决策 → 不渲染「置换抵挡」按钮', () => {
    const { root, state, hooks } = setup();
    state.pending = { kind: 'dunwuHalve', player: 'B' };
    renderGame(state, root, hooks);
    expect(root.textContent).not.toContain('置换进行抵挡');
  });

  it('只有「待抵挡」、无待决策 → 渲染「置换抵挡」按钮', () => {
    const { root, state, hooks } = setup();
    state.pending = null;
    renderGame(state, root, hooks);
    expect(root.textContent).toContain('置换进行抵挡');
  });
});
