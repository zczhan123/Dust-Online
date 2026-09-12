import './ui/styles.css';
import { createGame, applyAction } from './core/engine/game';
import { renderGame, type UiState } from './ui/render';
import type { GameState } from './core/model/types';

const root = document.getElementById('app');
if (!root) throw new Error('#app not found');
const state: GameState = createGame({ seed: 20240913, firstPlayer: 'A' });
const ui: UiState = { rerollSelected: new Set(), selection: null };
let lastError = '';
const render = () =>
  renderGame(state, root, {
    ui,
    requestRender: render,
    onAction: (a) => {
      try {
        applyAction(state, a);
        lastError = '';
        ui.rerollSelected.clear();
        ui.selection = null;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
      if (lastError) state.log.push({ turn: state.turnIndex, phase: state.phase, text: `非法操作：${lastError}` });
      render();
    },
  });
render();
