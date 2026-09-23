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
  hanguangPick: null,
  quanzhi: null,
  dustFlow: null,
  prefs: loadPrefs(),
  settingsOpen: false,
  logOpen: false,
  detail: null,
  error: null,
};

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
        ui.error = null;
        ui.rerollSelected.clear();
        ui.selection = null;
        ui.pendingConfirm = null;
        ui.convertPick = null;
        ui.fengmangPick = null;
        ui.hanguangPick = null;
        ui.dustFlow = null;
        ui.settingsOpen = false;
        ui.detail = null;
      }
      // 非法操作只在 UI 层提示（不写进引擎状态/战报）
      catch (e) { ui.error = `非法操作：${e instanceof Error ? e.message : String(e)}`; }
      render();
    },
  });
};

/** 每局随机种子（引擎内所有随机都走它；保证每局骰子序列不同，也便于将来做录像回放） */
const newSeed = (): number => Math.floor(Math.random() * 1_000_000_000);

const showSetup = () => {
  renderSetup(root, (opts) => {
    state = createGame({
      seed: newSeed(),
      firstPlayer: opts.firstPlayer,
      heroA: opts.heroA,
      heroB: opts.heroB,
    });
    ui.rerollSelected.clear();
    ui.selection = null;
    ui.pendingConfirm = null;
    ui.convertPick = null;
    ui.fengmangPick = null;
    ui.hanguangPick = null;
    ui.dustFlow = null;
    ui.settingsOpen = false;
    ui.detail = null;
    render();
  });
};

showSetup();
