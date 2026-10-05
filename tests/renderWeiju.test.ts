import { describe, it, expect } from 'vitest';
import { applyAction, createGame, skipInitialReroll } from '../src/core/engine/game';
import { renderGame, type RenderHooks, type UiState } from '../src/ui/render';
import { DEFAULT_PREFS, clonePrefs } from '../src/ui/prefs';
import type { GameState } from '../src/core/model/types';

/** A 持 022/023/024（希瓦），B 持 004/005/006（影）；A 进入主阶段、023「畏惧」置备。 */
function setup() {
  const root = document.createElement('div');
  const state: GameState = createGame({
    seed: 1,
    firstPlayer: 'A',
    heroA: ['022', '023', '024'],
    heroB: ['004', '005', '006'],
  });
  skipInitialReroll(state);
  let guard = 0;
  while (state.phase !== 'main' && state.phase !== 'gameOver' && guard++ < 12) {
    applyAction(state, { t: 'advance' });
  }
  const a023 = state.players.A.artifacts.find((a) => a.id === '023')!;
  a023.activeMarkerSide = 'left';
  a023.armedSide = 'left';
  a023.armedTurn = state.turnIndex;
  state.players.A.areas.meditation = [{ id: 'my', value: 5, kind: 'meditation' }];
  state.players.B.areas.attack = [{ id: 'theirs', value: 2, kind: 'attack' }];

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
    requestRender: () => renderGame(state, root, hooks),
    onRestart: () => {},
  };
  return { root, state, hooks };
}

describe('023 畏惧 · 响应池渲染（发起帧 / 支付帧不抛错）', () => {
  it('发起帧：renderGame 消费 weiju 事件、进入等待、不抛错', () => {
    const { root, state, hooks } = setup();
    applyAction(state, { t: 'skill', artifactId: '023', side: 'left', params: { dieId: 'my' } });
    expect(state.pending?.kind).toBe('weijuPay');
    expect(() => renderGame(state, root, hooks)).not.toThrow();
  });

  it('支付帧：renderGame 不抛错（响应池并排消失）', () => {
    const { root, state, hooks } = setup();
    applyAction(state, { t: 'skill', artifactId: '023', side: 'left', params: { dieId: 'my' } });
    renderGame(state, root, hooks);
    applyAction(state, { t: 'weijuPay', dieId: 'theirs' });
    expect(() => renderGame(state, root, hooks)).not.toThrow();
  });
});
