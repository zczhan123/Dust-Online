import type { GameState, Pending, PlayerId } from '../model/types';
import { hasActiveSkill, skillUseKey } from './skill-state';
import { gainRandomAbilityDice, withRngState } from './effects';
import { effectiveWill, totalDice } from './derive';
import { logLine, pname, valsSorted } from './log';
import { applyMolu } from './combat';
import { fxSkillFired } from './fx';
import { enemiesOf, rosterOf } from '../model/participants';

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
  for (const id of rosterOf(g)) {
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
  // 出队时跳过"已经没意义"的待决策（不弹窗，但要写战报说明为什么跳过 = 不静默）
  while (next) {
    // 结束阶段「超出意志上限」的选择：若前面（032/033 等）已把骰弃到上限内，则跳过、不打扰玩家
    if (
      next.kind === 'endDiscard' &&
      totalDice(g.players[next.player]) <= effectiveWill(g.players[next.player])
    ) {
      next = g.pendingQueue.shift();
      continue;
    }
    // 011「灵能脉冲·触发」：**能多次触发，但一回合只能使用 1 次**。
    // 本回合已经用过 → 后面排队的触发逐条作废（问也不问，但战报留痕）。
    if (next.kind === 'dunwuPulse' && g.dunwuPulseUsed[next.player]) {
      logLine(g, `${pname(next.player)} 「灵能脉冲」：本回合已使用 → 跳过（本次消耗 ${next.amount} 颗）`);
      next = g.pendingQueue.shift();
      continue;
    }
    break;
  }
  if (next) g.pending = next;
}

export function queuePending(g: GameState, p: Pending): void {
  g.pendingQueue.push(p);
}

/**
 * 「即时反应」类待决策：**不是**"准备攻击"，而是在回答"要不要取消伤害 / 减半 / 选目标"。
 * 用于抑制同一时刻**不相关**的提示：
 *  - `.hint-global` 里的 027「凛冽之音」常驻行（只在反应类待决策期间隐藏，其它时候照常显示）；
 *  - `battleNotes` 的「攻击提示」行（此时看攻击提示没有意义）。
 * ⚠️ **不要**把「使用攻击骰前」的选择（022 `sijiChuxing`、027 `hanguangPick`）加进来——那正是最该看提示的时刻。
 */
const REACTION_PENDING_KINDS: string[] = ['guwangCancel', 'dunwuHalve', 'dunwuPulse', 'ciBei'];

export function isReactionPending(p: Pending | null | undefined): boolean {
  return !!p && REACTION_PENDING_KINDS.includes(p.kind);
}

/**
 * 011「灵能脉冲·触发」：把**本次动作**里"通过技能消耗的能力骰格数"转成待决策。
 *
 * - 记账来源＝`paySlots`（reason='skill'，按付款人记格数），所以任何模式 / 座位 / 技能都不会漏。
 * - **能多次触发，但一回合只能用 1 次**：每次消耗各生成一条（不合并、不吞掉）；
 *   用掉之后由 `pumpPending` 跳过其余条目。
 * - **幂等**：处理完就把计数器清空 → 同一个动作里多次调用（如攻击队列先泵一次、收尾再泵一次）不会重复生成；
 *   也避免"消耗了但没 011"时永远挡住攻击队列。
 * - 板上已占 → `queuePending`（排队，不静默丢弃）；板上空闲 → 直接挂（保持"先脉冲、后 028 天罚"的既有顺序）。
 */
export function queueDunwuPulseForAction(g: GameState): void {
  const entries = Object.entries(g.skillConsumedThisAction);
  if (entries.length === 0) return;
  g.skillConsumedThisAction = {};
  if ((g.phase as string) === 'gameOver') return;
  for (const [payerId, amount] of entries) {
    const payer = payerId as PlayerId;
    const n = amount ?? 0;
    if (n <= 0) continue;
    if (!hasActiveSkill(g.players[payer], 'dunwu.pulse.trigger')) continue;
    if (g.dunwuPulseUsed[payer]) continue; // 本回合已使用 → 不再生成
    const pulse: Pending = { kind: 'dunwuPulse', player: payer, amount: n };
    if (g.pending === null) g.pending = pulse;
    else queuePending(g, pulse);
  }
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
  for (const other of enemiesOf(g, reroller)) {
    const o = g.players[other];
    if ((opts?.includeLeibao ?? true) && hasActiveSkill(o, 'minglei.leibao.continuous')) {
      queuePending(g, { kind: 'leibaoReroll', player: other });
    }
    if (hasActiveSkill(o, 'youming.weimu')) {
      queuePending(g, { kind: 'weimu', player: other, target: reroller });
    }
  }
}
