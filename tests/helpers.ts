import { applyAction, getLegalActions } from '../src/core/engine/game';
import type { GameState } from '../src/core/model/types';

/**
 * 测试工具：一路 `advance` 到**主要阶段**。
 *
 * 背景：引擎现在会「没得做就自动翻页」（重掷/尘起/初始重掷阶段无可做之事时自动推进）。
 * 因此"`skipInitialReroll` → 一次 `advance` 到 main"的旧写法可能**走过头**（自动推进已经把该阶段走完了）。
 * 需要"到主要阶段"的测试统一改用本函数：**只在还没到 main 时补推进**。
 */
export function toMain(g: GameState): void {
  let guard = 0;
  while (g.phase !== 'main' && g.phase !== 'gameOver' && guard++ < 8) {
    if (g.pending || g.pendingAttack) break; // 让位待决策（不替测试做决定）
    applyAction(g, { t: 'advance' });
  }
}

/**
 * 挑战模式：把「昔日传奇」的回合按节奏（`challengeStep`）驱动到结束。
 * 遇待抵挡自动"不抵挡"；遇代决（`challengePick`）**抛错**——那种用例请自行逐步处理。
 */
export function driveLegendTurn(g: GameState): void {
  let guard = 0;
  while (g.activePlayer === 'B' && g.phase !== 'gameOver' && guard++ < 80) {
    if (g.pendingAttack) {
      // 用合法动作（可能是"不抵挡"，也可能是"用某颗骰抵挡"——传奇防御规则要求挡时后者）
      const legal = getLegalActions(g);
      const block = legal.find((a) => a.t === 'block') ?? legal[0];
      applyAction(g, block);
    } else if (g.pending) throw new Error(`legend turn left a pending: ${(g.pending as { kind: string }).kind}`);
    else applyAction(g, { t: 'challengeStep' });
  }
}
