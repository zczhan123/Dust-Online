import type { GameState } from '../model/types';

/** 有玩家在尘起阶段不想/不能尘起行动时调用：尘落 +1；达 10 立即结束 */
export function incrementDustfall(g: GameState): void {
  g.dustfall += 1;
  if (g.dustfall >= 10) {
    g.phase = 'gameOver';
    const a = g.players.A.life;
    const b = g.players.B.life;
    g.winner = a > b ? 'A' : b > a ? 'B' : g.activePlayer;
  }
}
