import { getLegalActions } from '../core/engine/game';
import type { Action, GameState, PlayerId } from '../core/model/types';
import type { NetSession } from '../net/session';

/**
 * 行动倒计时（第 4 批 · 4b）。
 *
 * - **操作方**跑表：进入"自己的新阶段 / 新待决策" → 开一段新倒计时，并**广播** `timer`（开始时刻 + 时长）。
 * - **双方**都画**同一条**进度条（细紫、融进快速操作栏下框线）；同机＝完全同步、跨机＝近似（时钟不同）。
 * - **到点**：仅**本机为操作方**时发一条"超时动作"（`timeoutAction`）——**时钟不进引擎**（防分叉）。
 * - "**向导未派发** → 不发动"这一层由宿主（`main.ts`）处理（向导打开时先关向导、不派发）。
 */

let session: NetSession | null = null;
let myPlayer: PlayerId | null = null;
let getState: (() => GameState | null) | null = null;
let onTimeout: ((a: Action) => void) | null = null;
let turnMs = 30_000;
let cur: { actor: PlayerId; startAt: number; ms: number } | null = null;
let startedKey = '';
let fired = false;
let raf = 0;
let paused = false;
let pauseStart = 0;

export function bindTurnTimer(o: {
  session: NetSession;
  myPlayer: PlayerId;
  getState: () => GameState | null;
  onTimeout: (a: Action) => void;
  turnSeconds: number;
}): void {
  session = o.session;
  myPlayer = o.myPlayer;
  getState = o.getState;
  onTimeout = o.onTimeout;
  turnMs = Math.max(1, o.turnSeconds) * 1000;
  cur = null;
  startedKey = '';
  fired = false;
  paused = false;
  pauseStart = 0;
  if (!raf) raf = requestAnimationFrame(loop);
}

export function unbindTurnTimer(): void {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  session = null;
  myPlayer = null;
  getState = null;
  onTimeout = null;
  cur = null;
  startedKey = '';
  fired = false;
  paused = false;
  pauseStart = 0;
}

/** 暂停/恢复倒计时（联机"对方掉线"时暂停）：暂停期间冻结读数；恢复后**剩余时间不变**（顺延 startAt） */
export function setTurnTimerPaused(p: boolean): void {
  if (p === paused) return;
  paused = p;
  if (p) {
    pauseStart = Date.now();
  } else if (cur && pauseStart) {
    cur = { ...cur, startAt: cur.startAt + (Date.now() - pauseStart) };
    pauseStart = 0;
  }
}

const actorIn = (st: GameState): PlayerId =>
  st.pending ? st.pending.player : st.pendingAttack ? (st.pendingAttack.attacker === 'A' ? 'B' : 'A') : st.activePlayer;

/** 战斗界面渲染前调用：决定本段倒计时的来源（本机为操作方→开新表并广播；否则用对端广播） */
export function turnTimerTick(): void {
  const st = getState?.();
  if (!st || st.phase === 'gameOver') {
    cur = null;
    return;
  }
  const actor = actorIn(st);
  const key = `${actor}:${st.phase}`;
  if (myPlayer && actor === myPlayer) {
    if (startedKey !== key) {
      startedKey = key;
      fired = false;
      cur = { actor, startAt: Date.now(), ms: turnMs };
      session?.sendTimer(actor, cur.startAt, cur.ms);
    }
  } else {
    const rt = session?.state.timer;
    if (rt) cur = { actor: rt.side, startAt: rt.startAt, ms: rt.ms };
  }
}

export function turnFraction(): number | null {
  if (!cur) return null;
  const now = paused ? pauseStart : Date.now();
  return Math.max(0, Math.min(1, 1 - (now - cur.startAt) / cur.ms));
}

function isDecline(a: Action): boolean {
  const any = a as Record<string, unknown>;
  if (any.cancel === true || any.decline === true || any.accept === false) return true;
  if (a.t === 'block') {
    const cs = any.costSlots as unknown[] | undefined;
    return !cs || cs.length === 0; // 不抵挡
  }
  return false;
}

/** 到点默认动作：阶段→`advance`；待抵挡 / 可放弃→放弃；**强制**待决策→引擎默认（`getLegalActions` 第一项） */
export function timeoutAction(st: GameState): Action {
  const legal = getLegalActions(st);
  if (st.pending || st.pendingAttack) return legal.find(isDecline) ?? legal[0];
  return legal.find((a) => a.t === 'advance') ?? legal[0];
}

function loop(): void {
  const f = turnFraction();
  const el = document.querySelector<HTMLElement>('.turn-timer');
  if (el && f != null) el.style.transform = `scaleX(${f})`;
  if (cur && f != null && f <= 0 && !fired && myPlayer && cur.actor === myPlayer) {
    fired = true;
    const st = getState?.();
    if (st && onTimeout) onTimeout(timeoutAction(st));
  }
  raf = requestAnimationFrame(loop);
}
