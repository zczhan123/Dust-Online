import type { NetSession } from '../net/session';

/**
 * 联机模式 ·「进入战斗」通道。
 *
 * 选择页在**对局生成后**（房主 `session.startGame` / 访客收到 `start`）调用 `enterOnlineBattle`，
 * 由 `main.ts` 注册的 handler 接管 → 切到战斗界面（渲染 `session.state.game`、固定视角、动作走 session）。
 *
 * 这样选择页不必依赖 `main.ts`——两边只通过这个小通道通信。
 */
let handler: ((s: NetSession) => void) | null = null;

export function setOnlineBattleHandler(cb: (s: NetSession) => void): void {
  handler = cb;
}

export function enterOnlineBattle(s: NetSession): void {
  handler?.(s);
}
