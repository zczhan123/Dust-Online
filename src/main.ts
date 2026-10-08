import './ui/styles.css';
import { createGame, createChallengeGame, applyAction, getLegalActions } from './core/engine/game';
import { renderGame, setLocalViewPlayer, actorOf, lastFrameDurationMs, type UiState } from './ui/render';
import { renderSetup, type SetupOptions } from './ui/setupScreen';
import { renderLobby } from './ui/lobby';
import { createOnlineShell, type OnlineShell } from './ui/online';
import { setOnlineBattleHandler } from './ui/onlineMode';
import { loadPrefs, savePrefs } from './ui/prefs';
import type { Action, GameState, PlayerId } from './core/model/types';
import { bindTurnTimer, unbindTurnTimer, setTurnTimerPaused } from './ui/turnTimer';
import { hasSavedRoom, type NetSession } from './net/session';

const root = document.getElementById('app');
if (!root) throw new Error('#app not found');

let state: GameState | null = null;
let online: NetSession | null = null; // 联机对局会话（非空＝当前在联机对局）
let battleShell: OnlineShell | null = null; // 战斗界面的聊天浮层

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
  logPop: false,
  detail: null,
  error: null,
};

/** 每局随机种子（引擎内所有随机都走它；也便于将来做录像回放） */
const newSeed = (): number => Math.floor(Math.random() * 1_000_000_000);

const resetUi = (): void => {
  ui.rerollSelected.clear();
  ui.selection = null;
  ui.pendingConfirm = null;
  ui.convertPick = null;
  ui.fengmangPick = null;
  ui.hanguangPick = null;
  ui.dustFlow = null;
  ui.settingsOpen = false;
  ui.onlineLeaveOpen = false;
  ui.detail = null;
};

/** 联机退出到大厅（胜利「回大厅」/「对方掉线」弹框的"退回大厅"共用） */
const leaveOnlineToLobby = (): void => {
  online?.leaveRoom();
  online?.close();
  unbindTurnTimer();
  battleShell?.dispose();
  battleShell = null;
  online = null;
  setLocalViewPlayer(null);
  goLobby();
};

/** 联机对局的战斗 UI 上下文（**缺省＝左右互搏**） */
const onlineUi = () => {
  if (!online) return undefined;
  const mem = online.state.members;
  const host = mem.find((m) => m.role === 'host');
  const guest = mem.find((m) => m.role === 'guest');
  return {
    myPlayer: (online.state.myPlayer ?? 'A') as PlayerId,
    names: { A: host?.name ?? '玩家A', B: guest?.name ?? '玩家B' } as Record<PlayerId, string>,
    peerOnline: online.state.peerOnline,
    onLeaveLobby: leaveOnlineToLobby,
    onChat: () => battleShell?.toggleChat(),
  };
};

/** 挑战模式：传奇回合"逐条结算"的**下限**节奏（毫秒）。实际＝`max(它, 本帧动画总时长)` → 每步播完才走下一步。 */
const CHALLENGE_STEP_MS = 700;
let challengeStepTimer: number | null = null;

/** 统一派发（联机走 session、本地走引擎）+ 重置 UI + 重绘；供 onAction 与挑战模式自动推进共用 */
const dispatchAction = (a: Action): void => {
  if (!state) return;
  // 联机·非本人操作 → 忽略（兜底：任何漏门禁的派发都不生效，防两端分叉）
  if (online && actorOf(state) !== online.state.myPlayer) return;
  // 联机·对方掉线/退出（暂停中）→ 忽略本地动作（锁步下防分叉）
  if (online && (!online.state.peerOnline || online.state.peerLeft)) return;
  try {
    if (online) online.dispatch(a); // 联机：本地应用 + 广播（对端回放）
    else applyAction(state, a);
    ui.error = null;
    resetUi();
  } catch (e) {
    ui.error = `非法操作：${e instanceof Error ? e.message : String(e)}`;
  }
  render();
};

/** 挑战模式：传奇回合会"停一下"等界面推进 → 按节奏自动派发下一步（让每条技能都看得见） */
const scheduleChallengeStep = (): void => {
  if (challengeStepTimer != null) {
    window.clearTimeout(challengeStepTimer);
    challengeStepTimer = null;
  }
  if (!state || state.mode !== 'challenge') return;
  if (online && (!online.state.peerOnline || online.state.peerLeft)) return;
  if (online && actorOf(state) !== online.state.myPlayer) return;
  if (!getLegalActions(state).some((a) => a.t === 'challengeStep')) return;
  challengeStepTimer = window.setTimeout(() => {
    challengeStepTimer = null;
    if (!state) return;
    if (!getLegalActions(state).some((a) => a.t === 'challengeStep')) return;
    dispatchAction({ t: 'challengeStep' });
  }, Math.max(CHALLENGE_STEP_MS, lastFrameDurationMs()));
};

const render = (): void => {
  if (!state) return;
  renderGame(state, root, {
    ui,
    online: onlineUi(),
    requestRender: render,
    propose: (action, label) => {
      ui.pendingConfirm = { action, label };
      render();
    },
    onRestart: () => {
      state = null;
      online = null;
      unbindTurnTimer();
      battleShell?.dispose();
      battleShell = null;
      setLocalViewPlayer(null);
// 刷新后若本标签页"上次还在房里" → 直接进联机大厅（会自动尝试重连，拿到状态快照即回战斗）
if (hasSavedRoom()) goLobby();
else showSetup();
    },
    onPrefsChange: (p) => savePrefs(p),
    onAction: (a) => dispatchAction(a),
  });
  scheduleChallengeStep();
};

/** 到点超时：向导/确认条打开 → 关掉＝不发动（不派发）；否则派发引擎默认 / 放弃 / 结束阶段 */
const timeoutDispatch = (a: Action): void => {
  if (!state) return;
  if (online && (!online.state.peerOnline || online.state.peerLeft)) return; // 对方掉线/退出（暂停中）→ 不发超时动作
  if (ui.selection || ui.dustFlow || ui.pendingConfirm) {
    resetUi();
    render();
    return;
  }
  try {
    online?.dispatch(a);
    ui.error = null;
    resetUi();
  } catch (e) {
    ui.error = `超时操作非法：${e instanceof Error ? e.message : String(e)}`;
  }
  render();
};

/** 本地对局开局（左右互搏；联机大厅进入的选择页也用它兜底） */
const startLocal = (opts: SetupOptions): void => {
  if (opts.challengeCardId) {
    // 单人挑战：对手＝挑战卡自动机；固定视角＝挑战者恒在下方（本模式**不做 A/B 换位**）
    state = createChallengeGame({
      seed: newSeed(),
      cardId: opts.challengeCardId,
      challenger: opts.heroA,
      tactic: opts.tacticA,
    });
    setLocalViewPlayer('A');
  } else {
    state = createGame({
      seed: newSeed(),
      firstPlayer: opts.firstPlayer,
      heroA: opts.heroA,
      heroB: opts.heroB,
      legendA: opts.legendA,
      legendB: opts.legendB,
      tactics: opts.tactics,
      tacticA: opts.tacticA,
      tacticB: opts.tacticB,
    });
  }
  resetUi();
  render();
};

const showSetup = (): void => {
  online = null;
  unbindTurnTimer();
  setLocalViewPlayer(null); // 回左右互搏默认（谁操作谁在下方）
  renderSetup(root, startLocal);
};

/** 回联机大厅（胜利「回大厅」用） */
const goLobby = (): void => {
  renderLobby(root, showSetup, startLocal);
};

/** 战斗界面聊天浮层的挂载层：挂到 body（`renderGame` 每次会清空 #app，挂 #app 里会被清掉） */
const onlineLayer = (): HTMLElement => {
  let layer = document.getElementById('online-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'online-layer';
    document.body.appendChild(layer);
  }
  return layer;
};

// 联机：对局生成后 → 切战斗界面（渲染 session 的对局；固定视角；动作走 session）
setOnlineBattleHandler((session) => {
  online = session;
  battleShell?.dispose();
  battleShell = createOnlineShell({ session, onExit: () => {}, onGiveUp: leaveOnlineToLobby }, onlineLayer());
  state = session.state.game;
  setLocalViewPlayer(session.state.myPlayer);
  bindTurnTimer({
    session,
    myPlayer: session.state.myPlayer ?? 'A',
    getState: () => state,
    onTimeout: timeoutDispatch,
    turnSeconds: session.state.config?.turnSeconds ?? 30,
  });
  session.subscribe((s) => {
    setTurnTimerPaused(!s.peerOnline || s.peerLeft); // 对方掉线/退出 → 暂停倒计时；恢复 → 继续
    if (s.game) {
      state = s.game;
      render();
    }
  });
  render();
});

showSetup();
