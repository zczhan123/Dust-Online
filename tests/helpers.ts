import { applyAction } from '../src/core/engine/game';
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
