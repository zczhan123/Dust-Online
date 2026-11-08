/**
 * 「这一刀会怎样」——给 2v2 守方投票用的**试算**（2026-11-07）。
 *
 * 背景：2v2 守方选择时，得先由守方投票"谁去应对"，投完才派发；但守方在投票前要能看到
 * 「被几点攻击骰攻击、造成多少伤害、能不能挡」。这些数字必须和真正结算时**完全一致**，
 * 所以不能在 UI 里另写一份伤害公式。
 *
 * 做法：把当前状态**深拷贝一份**，在副本上跑一次真实的 `applyAction`（临时指定一个敌人座位），
 * 读出副本里的 `pendingAttack`，随后把副本丢掉。
 * - 真局一个字节都不改；
 * - 引擎的随机数是状态内的 `rngState`（副本自带）→ 不影响真局；
 * - 骰子 id 计数器是模块级的 → 用 `get/setDieIdCounter` 快照复原；
 * - 旁路事件（fx）在副本里产生 → 用完 `fxTake()` 丢弃（调用点保证此刻没有待消费事件）。
 */
import { applyAction } from '../core/engine/game';
import { fxTake } from '../core/engine/fx';
import { getDieIdCounter, setDieIdCounter } from '../core/model/dice';
import { enemiesOf } from '../core/model/participants';
import type { Action, GameState, PendingAttack, PlayerId } from '../core/model/types';

const cloneState = (state: GameState): GameState | null => {
  try {
    if (typeof structuredClone === 'function') return structuredClone(state);
  } catch {
    /* 落到 JSON */
  }
  try {
    return JSON.parse(JSON.stringify(state)) as GameState;
  } catch {
    return null;
  }
};

/** 在状态副本上试算一次动作 → 拿到引擎算好的 `pendingAttack`（失败/不产生攻击 → null）。 */
export function previewPendingAttack(state: GameState, action: Action): PendingAttack | null {
  const enemies = enemiesOf(state, state.activePlayer);
  if (enemies.length === 0) return null;
  const provisional = enemies[0] as PlayerId;
  const clone = cloneState(state);
  if (!clone) return null;
  const counter = getDieIdCounter();
  fxTake(); // 调用点保证此刻没有待消费的旁路事件
  try {
    const withTarget = {
      ...action,
      target: (action as { target?: PlayerId }).target ?? provisional,
    } as Action;
    applyAction(clone, withTarget);
    return clone.pendingAttack ?? null;
  } catch {
    return null;
  } finally {
    setDieIdCounter(counter);
    fxTake();
  }
}

