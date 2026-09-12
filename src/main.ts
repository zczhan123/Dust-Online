import './ui/styles.css';
import { createGame, applyAction } from './core/engine/game';
import { renderGame } from './ui/render';
import type { GameState } from './core/model/types';

const root = document.getElementById('app');
if (!root) throw new Error('#app not found');

const state: GameState = createGame({ seed: 20240913, firstPlayer: 'A' });
let lastError = '';

const render = () =>
  renderGame(state, root, {
    onAction: (a) => {
      try {
        applyAction(state, a);
        lastError = '';
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
      if (lastError) {
        state.log.push({ turn: state.turnIndex, phase: state.phase, text: `非法操作：${lastError}` });
      }
      render();
    },
  });

render();
