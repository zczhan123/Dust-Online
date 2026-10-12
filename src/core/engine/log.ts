import { CHALLENGES } from '../content/challenges';
import type { GameState, Phase, PlayerId } from '../model/types';

export function pname(id: PlayerId): string {
  return id === 'A' ? '玩家A' : '玩家B';
}

/** 挑战模式下「玩家B」的**界面**显示名（操作栏/提示/生命条统一叫「昔日传奇」）。 */
export const LEGEND_DISPLAY_NAME = '昔日传奇';

export function logLine(g: GameState, text: string, phase: Phase = g.phase): void {
  // 挑战模式：战报里 B 一律用**卡名**（唯一替换点，别在各处手写）——
  //  · `玩家B` → 「黑枪」；  · 叙述里的「昔日传奇」 → 「黑枪」（保持"录像"里是具体英雄名）。
  //  ⚠️ 与**界面**口径有意区分（界面仍用「昔日传奇」）；勿"统一"。
  const card =
    g.mode === 'challenge' && g.challenge ? CHALLENGES.find((c) => c.id === g.challenge!.cardId) : undefined;
  const shown = card
    ? text.replace(/玩家B/g, `「${card.legacy}」`).replace(/昔日传奇/g, card.legacy)
    : text;
  g.log.push({ turn: g.turnIndex, phase, text: shown });
}

export function vals(dice: { value: number }[]): string {
  return dice.map((d) => `${d.value}点`).join('、');
}
