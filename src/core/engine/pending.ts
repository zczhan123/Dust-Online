import type { GameState, Pending, PlayerId } from '../model/types';
import { hasActiveSkill, skillUseKey } from './skill-state';
import { gainRandomAbilityDice, withRngState } from './effects';
import { effectiveWill, totalDice } from './derive';
import { logLine, pname, valsSorted } from './log';
import { applyMolu } from './combat';
import { fxSkillFired } from './fx';

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
    // 动效旁路：强制发动也要走"居中必杀横幅"（此前该路径完全不发事件 → 既无横幅也无气泡）
    fxSkillFired(g, id, 'zhihai.bloom.ultimate');
    withRngState(g, (rng) => {
      const gained = gainRandomAbilityDice(g, id, x, rng);
      logLine(
        g,
        `${pname(id)} 「漆黑绽放」计数达到 5，必杀强制发动：获得 ${gained.length} 个随机点数能力骰（${valsSorted(gained)}）`,
      );
    });
    logLine(g, `「${card.name}」：本神器失去持续式效果`);
    // 战术牌 T04「末路」：此为「启动必杀式」，同样触发。
    // **先结算它的真伤**（此刻无待决策 → 对方 009 高塔铁幕 / 己方 T09 慈悲 的"取消"钩子能正常挂起，
    // 与"手动发动必杀"路径行为一致）；**再**把「漆黑绽放重掷」设为当前待决策
    //（若已被上面的取消钩子占用 → 排进队列，不覆盖）。
    //
    // ⚠️ 技术债（2026-10-07 用户裁定 B）：FAQ 18.1.2「同一技能的不同部分优先结算完毕」原意是
    // "018 自己的重掷先于其它触发"；这里为了让"末路真伤可被取消"把顺序反过来（真伤先、重掷后）。
    // 详见 plans/开发待办与方向.md §O。
    applyMolu(g, id);
    if (g.pending === null) g.pending = { kind: 'zhihaiReroll', player: id, x, forced: true };
    else queuePending(g, { kind: 'zhihaiReroll', player: id, x, forced: true });
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
