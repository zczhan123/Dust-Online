import type { GameState, Phase, PlayerId } from '../model/types';

export function pname(id: PlayerId): string {
  return id === 'A' ? '玩家A' : '玩家B';
}

/** 挑战模式下「玩家B」的显示名（统一叫「昔日传奇」）。 */
export const LEGEND_DISPLAY_NAME = '昔日传奇';

export function logLine(g: GameState, text: string, phase: Phase = g.phase): void {
  // 挑战模式：战报里不再称呼「玩家B」，统一改称「昔日传奇」（唯一替换点，别在各处手写）
  const shown =
    g.mode === 'challenge' && g.challenge ? text.replace(/玩家B/g, LEGEND_DISPLAY_NAME) : text;
  g.log.push({ turn: g.turnIndex, phase, text: shown });
}

export function vals(dice: { value: number }[]): string {
  return dice.map((d) => `${d.value}点`).join('、');
}
