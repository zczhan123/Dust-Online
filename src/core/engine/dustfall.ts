import type { GameState, PlayerId } from '../model/types';

/** 有玩家在尘起阶段不想/不能尘起行动时调用：尘落 +1；达 10 立即结束 */
export function incrementDustfall(g: GameState): void {
  g.dustfall += 1;
  if (g.dustfall >= 10) {
    g.phase = 'gameOver';
    const teamMode = g.rules?.lifeModel === 'perTeam';
    const a = teamMode ? (g.teams?.A?.life ?? 0) : g.players.A.life;
    const b = teamMode ? (g.teams?.B?.life ?? 0) : g.players.B.life;
    const activeTeam =
      teamMode
        ? ((g.teamOf?.[g.activePlayer] as PlayerId | undefined) ?? g.activePlayer)
        : g.activePlayer;
    g.winner = a > b ? 'A' : b > a ? 'B' : activeTeam;
  }
}
