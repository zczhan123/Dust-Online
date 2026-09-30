import type { GameState, PlayerId } from '../model/types';
import { SKILL_HANDLERS } from './skills';
import { withRngState } from './effects';
import { pumpPending, queuePending } from './pending';

/**
 * 执行第三列神器的「充能效果」（`kind:'charge'` 的技能）。
 * 由「尘起·充能」与 L03 传奇面板·统御战场（受攻击伤害 → 孤王充能 +1）共用。
 * - `needsChoice`（如 024 狂舞）：弹强制选择器（`chargeResolve`）。
 * - 其余（如 009 高塔铁幕）：直接执行其效果（可能自行挂待决策）。
 * 待决策一律走 `queuePending + pumpPending`：已有待决策时排队、不覆盖。
 */
export function runChargeSkill(
  g: GameState,
  player: PlayerId,
  artifactId: string,
  endMainPhase: () => void = () => {},
): void {
  const a = g.players[player].artifacts.find((x) => x.id === artifactId);
  if (!a || a.column !== 3) return;
  const cs = a.skills.find((s) => s.kind === 'charge');
  if (cs && SKILL_HANDLERS[cs.key]) {
    if (cs.needsChoice) {
      queuePending(g, { kind: 'chargeResolve', player, artifactId });
      pumpPending(g);
      return;
    }
    withRngState(g, (rng) =>
      SKILL_HANDLERS[cs.key].run({
        g,
        player,
        artifact: a,
        rng,
        params: {},
        endMainPhase,
        reportConsumed: () => {},
      }),
    );
  }
}
