import type { GameState, Pending, PlayerId } from '../model/types';
import { hasActiveSkill, skillUseKey } from './skill-state';
import { gainRandomAbilityDice, withRngState } from './effects';
import { effectiveWill, totalDice } from './derive';
import { logLine, pname, vals } from './log';

/** 012/015/018 通用的「失去持续式效果」判定：持续技能的 key + 神器标记 */
function findArtifactWithSkill(g: GameState, player: PlayerId, key: string) {
  return g.players[player].artifacts.find((a) => a.skills.some((s) => s.key === key));
}

/**
 * 018 至黑·漆黑绽放：计数达到 5 时必杀**强制立即发动**（无论现在是谁的回合）。
 * 在“当前没有任何待决策”时才能结算（同一技能的不同部分优先结算完毕，FAQ 18.1.2）。
 * 返回是否因此弹出了待决策。
 */
function checkZhihaiForced(g: GameState): boolean {
  for (const id of ['A', 'B'] as PlayerId[]) {
    const p = g.players[id];
    const card = findArtifactWithSkill(g, id, 'zhihai.bloom');
    if (!card) continue;
    if (card.continuousLost) continue;
    if (!hasActiveSkill(p, 'zhihai.bloom')) continue;
    if (g.ultimatesUsed.includes(skillUseKey(id, 'zhihai.bloom.ultimate'))) continue;
    if (card.count < 5) continue;
    const x = card.count;
    g.ultimatesUsed.push(skillUseKey(id, 'zhihai.bloom.ultimate'));
    card.continuousLost = true;
    withRngState(g, (rng) => {
      const gained = gainRandomAbilityDice(g, id, x, rng);
      logLine(
        g,
        `${pname(id)} 「漆黑绽放」计数达到 5，必杀强制发动：获得 ${gained.length} 个随机点数能力骰（${vals(gained)}）`,
      );
    });
    logLine(g, `「${card.name}」：本神器失去持续式效果`);
    g.pending = { kind: 'zhihaiReroll', player: id, x, forced: true };
    return true;
  }
  return false;
}

/** 把队列里的下一个待决策弹出来（队列用于多个触发同时排队，避免互相覆盖） */
export function pumpPending(g: GameState): void {
  if (g.pending || g.phase === 'gameOver') return;
  if (checkZhihaiForced(g)) return;
  let next = g.pendingQueue.shift();
  // 结束阶段「超出意志上限」的选择：若前面（032/033 等）已把骰弃到上限内，则跳过、不打扰玩家
  while (next && next.kind === 'endDiscard' && totalDice(g.players[next.player]) <= effectiveWill(g.players[next.player])) {
    next = g.pendingQueue.shift();
  }
  if (next) g.pending = next;
}

export function queuePending(g: GameState, p: Pending): void {
  g.pendingQueue.push(p);
}

/**
 * 「对方的重掷阶段结束时」的触发（013 雷暴·持续 / 017 帷幕）。
 * - 普通重掷阶段结束：013 与 017 都可能触发（同一玩家不可能同时拥有，故最多 1 条）。
 * - 额外重掷阶段结束（013 插入的）：只检查 017 帷幕（FAQ 17.1.2 可再次触发；不再触发 013 以免循环）。
 */
export function queueRerollEndTriggers(
  g: GameState,
  reroller: PlayerId,
  opts?: { includeLeibao?: boolean },
): void {
  const other: PlayerId = reroller === 'A' ? 'B' : 'A';
  const o = g.players[other];
  if ((opts?.includeLeibao ?? true) && hasActiveSkill(o, 'minglei.leibao.continuous')) {
    queuePending(g, { kind: 'leibaoReroll', player: other });
  }
  if (hasActiveSkill(o, 'youming.weimu')) {
    queuePending(g, { kind: 'weimu', player: other });
  }
}
