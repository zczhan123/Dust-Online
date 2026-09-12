import './ui/styles.css';
import { setupGame } from './core/engine/setup';
import { renderGame } from './ui/render';

const root = document.getElementById('app');
if (!root) throw new Error('#app not found');

const state = setupGame({ seed: 20240913, firstPlayer: 'A' });
renderGame(state, root);
