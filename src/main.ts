import './ui/styles.css';
import { createGame, applyAction } from './core/engine/game';
import { renderGame, type UiState } from './ui/render';
import { renderSetup } from './ui/setupScreen';
import { loadPrefs, savePrefs } from './ui/prefs';
import type { GameState } from './core/model/types';

const root = document.getElementById('app');
if (!root) throw new Error('#app not found');

let state: GameState | null = null;
const ui: UiState = {
  rerollSelected: new Set(),
  selection: null,
  pendingConfirm: null,
  convertPick: null,
  fengmangPick: null,
  dustFlow: null,
  prefs: loadPrefs(),
  settingsOpen: false,
  logOpen: false,
  detail: null,
};
let lastError = '';

const render = () => {
  if (!state) return;
  renderGame(state, root, {
    ui,
    requestRender: render,
    propose: (action, label) => { ui.pendingConfirm = { action, label }; render(); },
    onRestart: () => { state = null; showSetup(); },
    onPrefsChange: (p) => savePrefs(p),
    onAction: (a) => {
      if (!state) return;
      try {
        applyAction(state, a);
        lastError = '';
        ui.rerollSelected.clear();
        ui.selection = null;
        ui.pendingConfirm = null;
        ui.convertPick = null;
        ui.fengmangPick = null;
        ui.dustFlow = null;
        ui.settingsOpen = false;
        ui.detail = null;
      }
      catch (e) { lastError = e instanceof Error ? e.message : String(e); }
      if (lastError) state.log.push({ turn: state.turnIndex, phase: state.phase, text: `非法操作：${lastError}` });
      render();
    },
  });
};

const showSetup = () => {
  renderSetup(root, (opts) => {
    state = createGame({ seed: 20240913, firstPlayer: opts.firstPlayer, heroA: opts.heroA, heroB: opts.heroB });
    ui.rerollSelected.clear();
    ui.selection = null;
    ui.pendingConfirm = null;
    ui.convertPick = null;
    ui.fengmangPick = null;
    ui.dustFlow = null;
    ui.settingsOpen = false;
    ui.detail = null;
    render();
  });
};

showSetup();
