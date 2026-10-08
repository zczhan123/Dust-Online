import { setupGame, applyFirstPlayer, type SetupOptions } from './setup';
import { SeededRng } from '../rng/rng';
import { refillPhase, doReroll, endPhase } from './phases';
import { effectiveSpeed, effectiveWill, emptyDistribution, rerollAllowance, totalDice } from './derive';
import { applyDustRiseToArtifact, canTargetForDustRise } from './dustRise';
import { incrementDustfall } from './dustfall';
import { afterAttackResolved, applyLifeLoss, applyMolu, artifactWithSkill, attacksBanned, checkLifeEnd, maybeBarrier, doAttack, finalizeAttackResolution, halveAttackDamage, resolveBlock, dealTrueDamage, applyDeferredTrueDamage, pumpAttackQueue, virtualAttack, dianxingValuesOf, SHOUHUN_CONT_KEYS, YonghengQueenSignal, tacticActiveBonus, settleAttack, type AttackMods } from './combat';
import { abilityDieInfo, abilityDicePool, canPayCosts, defaultCostFills, findDieOf, gainRandomDice, maxAffordableSlots, setDieValue, applyHeal, heal, moveDice, noteLifeDrop, offerAdapt, paySlots, withRngState } from './effects';
import { areaOf, createDie, newDieId, placeDieByDistribution } from '../model/dice';
import { pumpPending, queuePending, queueRerollEndTriggers } from './pending';
import { fxPush, fxReset, fxTacticFired, fxSkillFired, fxSetSource } from './fx';
import { runChargeSkill } from './charge';
import { SKILL_HANDLERS, skillActive, consumeDice, consumeDiceByKind, applyTurnStartEffects, hasActiveSkill } from './skills';
import { skillUseKey } from './skill-state';
import { logLine, pname } from './log';
import { LEGEND_DUSTFALL_REQ } from '../content/legends';
import { CHALLENGES, type ChallengeCard, type ChallengeSkill } from '../content/challenges';
import { matchSlots, legendCanBlock } from './challenge';
import { TACTIC_POOL, TACTIC_BY_ID } from '../content/tactics';
import type { Action, Artifact, DiceKind, Die, GameState, LegendPanel, Pending, PlayerId, PlayerState, SkillDef, SlotFill } from '../model/types';

/** 把传奇英雄面板适配成 `Artifact` 形状（仅用于把面板技能送进统一技能处理器；不写入对局状态） */
function legendAsArtifact(lg: LegendPanel): Artifact {
  return {
    id: lg.id,
    name: lg.name,
    column: 1,
    activeMarkerSide: 'left',
    armedSide: null,
    armedTurn: -1,
    count: lg.count,
    countCap: lg.countCap,
    continuousLost: lg.continuousLost,
    continuousLostThisTurn: lg.continuousLostThisTurn,
    chargeLayer: 0,
    skills: lg.skills,
  };
}

/** 校验：这些骰必须是该玩家自己的、互不重复的冥想骰（越界抛错，不静默修正） */
function assertOwnMeditationDice(p: PlayerState, ids: string[]): void {
  if (new Set(ids).size !== ids.length) throw new Error('duplicate die id');
  for (const id of ids) {
    if (!p.areas.meditation.some((d) => d.id === id)) throw new Error(`not your meditation die: ${id}`);
  }
}

/** 034 破障（持续）：神器上存放的骰可当能力骰「使用/消耗」（类型按持有者第二列分布） */
function heldAbilityDice(g: GameState, player: PlayerId): { id: string; kind: DiceKind }[] {
  const p = g.players[player];
  if (!hasActiveSkill(p, 'jingang.pozhang.continuous')) return [];
  const dist = emptyDistribution(p);
  if (!dist) return [];
  const out: { id: string; kind: DiceKind }[] = [];
  for (const a of p.artifacts) for (const h of a.heldDice ?? []) out.push({ id: h.id, kind: areaOf(h.value, dist) });
  return out;
}

function withRng(g: GameState, fn: (rng: SeededRng) => void): void {
  withRngState(g, fn);
}

/** 若骰位中出现“置换”（2 颗真骰）填法，则要求该玩家已激活 010 深红的「真实之剑」 */
function assertConversionAllowed(g: GameState, player: PlayerId, fills?: SlotFill[]): void {
  const usesConversion = (fills ?? []).some((f) => f.dieIds.length === 2);
  if (usesConversion && !hasActiveSkill(g.players[player], 'shenhong.sword')) {
    throw new Error('conversion requires 真实之剑');
  }
}

/**
 * 025 屠虎·奇袭（持续）：可把**点数不在对方任何区域**的能力骰「视为攻击骰」使用（单骰跨类型）。
 * 返回该骰是否可用于攻击骰位（条件：奇袭已激活 + 该点数不在对方任意区域）。
 */
export function canTreatAsAttack(g: GameState, player: PlayerId, dieId: string): boolean {
  if (!hasActiveSkill(g.players[player], 'tuohu.qixi')) return false;
  const found = findDieOf(g, player, dieId);
  if (!found) return false;
  if (found.kind === 'attack') return false; // 本来就是攻击骰，无需「视为」
  const opp: PlayerId = player === 'A' ? 'B' : 'A';
  const v = found.die.value;
  const kinds: DiceKind[] = ['attack', 'defense', 'meditation'];
  return !kinds.some((k) => g.players[opp].areas[k].some((d) => d.value === v));
}

/** 027 寒光·必杀：是否处于「将要使用攻击骰」且神器上仍有骰子（用完即不再询问，必杀已用无法再次发动） */
export function canUseHanguang(g: GameState, player: PlayerId): boolean {
  const card = artifactWithSkill(g.players[player], 'hanguang.ultimate');
  return (card?.heldDice?.length ?? 0) > 0;
}

/** 校验所有「视为」填法都满足 025 奇袭的条件（越界抛错，不静默修正） */
function assertTreatedAllowed(g: GameState, player: PlayerId, fills?: SlotFill[]): void {
  for (const f of fills ?? []) {
    if (f.treated !== true) continue;
    if (f.dieIds.length !== 1) throw new Error('「视为」填法只能有 1 颗骰');
    if (!canTreatAsAttack(g, player, f.dieIds[0])) {
      throw new Error('「视为攻击骰」不满足 025 屠虎·奇袭的条件');
    }
  }
}

/**
 * 026 哀歌·陷阵：**重掷者自己的**重掷阶段结束时触发（普通路径与 013「雷暴」插入的额外重掷阶段路径**共用**）。
 * 由生命最少的一方（并列 = 重掷者本人，即「当前回合玩家」）弃置重掷者 1 颗能力骰；重掷者没有能力骰时不结算。
 */
/** 026 哀歌·「陷阵」的执行（**唯一入口**）：由两个时点共用 —— ① 重掷阶段结束（026 卡面）② L09「鏖战」的主要阶段结束。 */
function queueXianzhen(g: GameState, owner: PlayerId, reason: 'rerollEnd' | 'mainEnd' = 'rerollEnd'): boolean {
  if (!hasActiveSkill(g.players[owner], 'aige.xianzhen')) return false;
  const own = g.players[owner];
  if (!KINDS_ORDER.some((k) => own.areas[k].length > 0)) return false;
  const aLife = g.players.A.life;
  const bLife = g.players.B.life;
  const chooser: PlayerId = aLife < bLife ? 'A' : bLife < aLife ? 'B' : owner;
  queuePending(g, { kind: 'xianzhenPick', player: chooser, owner });
  logLine(
    g,
    `「陷阵」：${reason === 'mainEnd' ? '主要阶段结束（「鏖战」）' : '重掷阶段结束'}时，生命最低的一方（${pname(
      chooser,
    )}）选择弃置 ${pname(owner)} 的 1 个能力骰`,
  );
  return true;
}

/** 投 `n` 个驱动骰（非能力骰；`kind` 只作占位，**永不进区域**，只活在 `g.challenge.driven`）。 */
function rollDrivenDice(g: GameState, n: number): void {
  const before = g.challenge!.driven.length;
  withRngState(g, (rng) => {
    for (let i = 0; i < n; i++) {
      g.challenge!.driven.push(createDie(newDieId('drv-B-'), rng.rollDie(), 'meditation'));
    }
  });
  // 动效旁路：本回合投出的驱动骰（界面：中间并排冒出 → 飞入「临时驱动骰区域」）
  fxPush({
    kind: 'legendRoll',
    player: 'B',
    dice: g.challenge!.driven.slice(before).map((d) => ({ id: d.id, value: d.value })),
  });
}

/** 传奇防御骰上限截断：**保留最新、挤掉最旧**（被挤出的旧骰交给界面走通用"飞中间淡出"）。 */
function capLegendDefense(g: GameState, cap: number): { outIds: string[] } {
  const def = g.players.B.areas.defense;
  if (def.length <= cap) return { outIds: [] };
  const outIds = def.slice(0, def.length - cap).map((d) => d.id);
  g.players.B.areas.defense = def.slice(-cap);
  return { outIds };
}

/** 「锋芒」＝传奇攻击伤害 +计数：写成一个 thisTurn buff，走统一口径 `attackDamageBonus`。 */
function syncLegendFengmang(g: GameState): void {
  const p = g.players.B;
  p.buffs = p.buffs.filter((b) => b.source !== '传奇锋芒');
  const add = g.challenge?.count ?? 0;
  if (add > 0) p.buffs.push({ attr: 'attackDamage', add, duration: 'thisTurn', source: '传奇锋芒' });
}

/** 本条技能在**本局面**下需要挑战者代决的点（模式 1）。返回按顺序要收集的选择。
 *  `atDeferred`＝这句话是在"延后一步"阶段问的（例：暗夜凶神的"弃哪颗防御骰"应在 8 点攻击结算**之后**问）。 */
function challengeDecisions(
  g: GameState,
  skill: ChallengeSkill,
  consumedCount = 0,
  atDeferred = false,
): { prompt: string; options: { id: string; label: string }[] }[] {
  const A = g.players.A;
  const B = g.players.B;
  const defOpts = (): { id: string; label: string }[] =>
    A.areas.defense.map((d) => ({ id: d.id, label: `防${d.value}` }));
  switch (skill.id) {
    case 'z02-2':
      return A.areas.defense.length > 1
        ? [{ prompt: '「葬敌的完杀」：留哪 1 颗防御骰？（其余弃置）', options: defOpts() }]
        : [];
    case 'z02-3':
      // 卡面顺序：先 8 点攻击 →（攻击结算后）才问"弃哪颗防御骰"
      return atDeferred && A.areas.defense.length > 0
        ? [{ prompt: '「暗夜凶神」：弃置挑战者哪 1 颗防御骰？', options: defOpts() }]
        : [];
    case 'z02-4': {
      // 会用它全部攻击骰逐个攻击时才需要定顺序
      const atk = B.areas.attack.length + consumedCount;
      return atk > A.areas.defense.length && atk > 1
        ? [
            {
              prompt: '「枭首」：用全部攻击骰逐个攻击，按什么顺序？',
              options: [
                { id: 'asc', label: '由小到大' },
                { id: 'desc', label: '由大到小' },
              ],
            },
          ]
        : [];
    }
    default:
      return [];
  }
}

/**
 * 结算传奇的一条技能（导出供测试直接调用；`consumed` ＝本条消耗的驱动骰对象，点数仍保留）。
 * 返回本步的**动效事实**：`spawn`＝新获得的骰（及其区域）、`outIds`＝被「防御骰上限」挤出的旧骰。
 * （枭首 / 遁入暗影触发攻击时，新骰会被**立刻移进攻击队列**，界面拿不到区域差集 → 只能靠这里报出。）
 */
export function applyChallengeSkill(
  g: GameState,
  card: ChallengeCard,
  skill: ChallengeSkill,
  consumed: Die[],
): { spawn: { id: string; value: number; area: 'attack' | 'defense' | 'meditation' }[]; outIds: string[] } {
  const legacy = card.legacy;
  const vals = consumed.map((d) => d.value).sort((a, b) => a - b).join('/');
  logLine(g, `「${legacy}」：${skill.name}${vals ? `（消耗驱动骰 ${vals}）` : ''}`);
  const A = g.players.A;
  const B = g.players.B;
  const spawn: { id: string; value: number; area: 'attack' | 'defense' | 'meditation' }[] = [];
  const outIds: string[] = [];
  /** 传奇新获得一颗能力骰（登记进 `spawn`，供界面演"中间冒出 → 飞入区域"）。 */
  const gain = (area: 'attack' | 'defense' | 'meditation', value: number): void => {
    const d = createDie(newDieId('chg-B-'), value, area);
    B.areas[area].push(d);
    spawn.push({ id: d.id, value, area });
  };
  switch (skill.id) {
    case 'z02-0':
      return { spawn, outIds }; // 投驱动骰已在回合开始完成
    case 'z02-1':
      syncLegendFengmang(g);
      return { spawn, outIds };
    case 'z02-2': {
      // 尽可能弃置挑战者防御骰，直至剩 1（"留哪颗"＝代决，模式 1；未代决时默认留第一颗）
      const keepId = (g.challenge!.decisions?.[skill.id] ?? [])[0] ?? A.areas.defense[0]?.id;
      const drop = A.areas.defense.filter((d) => d.id !== keepId).map((d) => d.id);
      if (drop.length) consumeDice(g, A, 'defense', drop);
      // 获得 1/2/3/4 点攻击骰各 1
      for (const v of [1, 2, 3, 4]) gain('attack', v);
      return { spawn, outIds };
    }
    case 'z02-3': {
      // 卡面顺序：① 先发起 8 点「不可抵挡」攻击；② 攻击结算完**之后**才弃挑战者 1 颗防御骰；③ 最后计数 +1
      virtualAttack(g, 'B', 8, { skill: '暗夜凶神', owner: 'B' }, { unblockable: true });
      if (g.pendingAttack) {
        // 攻击已挂起 → 把"②弃骰 ③计数"记成延后效果，等这次攻击结算完回到传奇回合再执行
        g.challenge!.deferred = { skillId: skill.id, step: 0 };
      } else {
        // 极端兜底（攻击被禁等）：立刻按顺序补齐
        const dropId = (g.challenge!.decisions?.[skill.id] ?? [])[0] ?? A.areas.defense[0]?.id;
        if (dropId) consumeDice(g, A, 'defense', [dropId]);
        const cap = card.countCap ?? Number.POSITIVE_INFINITY;
        g.challenge!.count = Math.min(cap, g.challenge!.count + 1);
        syncLegendFengmang(g);
      }
      return { spawn, outIds };
    }
    case 'z02-4': {
      for (const d of consumed) gain('attack', d.value);
      // 若（传奇）攻击骰数 > 挑战者防御骰数 → 用全部攻击骰逐个攻击（走统一多段机制 virtualQueue）
      if (B.areas.attack.length > A.areas.defense.length) {
        // 骰子**留在攻击骰区**：队列条目带 dieId/dieStyle，轮到它时才从区里飞出并消耗（界面演"逐颗飞出攻击"）
        g.virtualQueue = B.areas.attack.map((d) => ({
          attacker: 'B' as PlayerId,
          value: d.value,
          label: '枭首',
          owner: 'B' as PlayerId,
          dieId: d.id,
          dieStyle: 'solid' as const,
        }));
        // 代决（模式 1）：攻击顺序（未代决时保持原顺序）
        const order = (g.challenge!.decisions?.[skill.id] ?? [])[0];
        if (order === 'asc') g.virtualQueue.sort((a, b) => a.value - b.value);
        else if (order === 'desc') g.virtualQueue.sort((a, b) => b.value - a.value);
        pumpAttackQueue(g);
      }
      return { spawn, outIds };
    }
    case 'z02-5': {
      for (const d of consumed) gain('defense', d.value);
      outIds.push(...capLegendDefense(g, card.defenseCap ?? Number.POSITIVE_INFINITY).outIds);
      // 每 1 组 → 1 次 2 点攻击（组数＝消耗骰数 ÷ 每槽颗数；Z02 单槽 → 1 组）
      const per = (skill.slots ?? []).reduce((s, x) => s + x.count, 0) || consumed.length || 1;
      const groups = Math.max(1, Math.floor(consumed.length / per));
      g.virtualQueue = Array.from({ length: groups }, () => ({
        attacker: 'B' as PlayerId,
        value: 2,
        label: '遁入暗影',
        owner: 'B' as PlayerId,
      }));
      pumpAttackQueue(g);
      return { spawn, outIds };
    }
    default:
      return { spawn, outIds };
  }
}

/**
 * 传奇的一个回合（说明书 page_15–16）：投驱动骰 → 按箭头逐条检查 → 全部查完 / 遇 `endsTurn` 即结束。
 * 不遵循常规阶段；**不存在尘落**；它的一切抉择由挑战者代决（模式 1，2d 接）。
 */
function runLegendTurn(g: GameState): void {
  const card = CHALLENGES.find((c) => c.id === g.challenge?.cardId);
  if (!g.challenge || !card || !card.skills) {
    endTurn(g); // 兜底：数据缺失也必须把回合交还，绝不卡死
    return;
  }
  g.phase = 'main'; // 传奇无阶段概念；仅作占位（回合内同步跑完）
  g.rerollUsed = 0;
  g.dustRiseNormalCount = 0;
  g.dustRiseActed = false;
  const legacy = card.legacy;
  logLine(g, `——「${legacy}」的回合——`);
  logLine(g, `「${legacy}」：回合开始`);
  rollDrivenDice(g, card.rollDice ?? 0);
  const rolled = [...g.challenge.driven]
    .map((d) => d.value)
    .sort((a, b) => a - b)
    .join('/');
  logLine(g, `「${legacy}」：投掷 ${card.rollDice ?? 0} 个驱动骰（${rolled}）`);
  // 投完即"停一下"：骰子落在**临时驱动骰区域**（driven），由界面按节奏派发 challengeStep 逐条结算
  g.challenge.slot = [];
  g.challenge.activeSkill = 0; // 高亮「回合开始」
  g.challenge.resumeAt = 1; // 下一条从技能 1 开始
}

/**
 * 收尾"延后一步"的效果（**按卡面顺序**：例「暗夜凶神」＝①8点攻击 →（攻击结算后）②弃挑战者1防御骰 →③计数+1）。
 * 只在攻击已结算完、回到传奇回合时执行；遇到"②的代决"就挂起等待。
 */
function resolveLegendDeferred(g: GameState, card: ChallengeCard): void {
  const d = g.challenge?.deferred;
  if (!g.challenge || !d) return;
  const skill = (card.skills ?? []).find((s) => s.id === d.skillId);
  if (!skill) {
    g.challenge.deferred = undefined;
    return;
  }
  const A = g.players.A;
  if (skill.id === 'z02-3') {
    // ② 弃挑战者 1 颗防御骰（弃哪颗＝代决，模式 1；**攻击结算之后**才问）
    const wants = challengeDecisions(g, skill, 0, true);
    const dec = (g.challenge.decisions ??= {});
    const got = dec[skill.id] ?? [];
    if (wants.length > got.length) {
      const w = wants[got.length];
      // 让代决归到**这条技能**（challengePick 按 activeSkill 存选择）
      g.challenge.activeSkill = (card.skills ?? []).indexOf(skill);
      g.pending = { kind: 'challengePick', player: 'A', prompt: w.prompt, options: w.options };
      return; // 停在代决
    }
    const dropId = (dec[skill.id] ?? [])[0] ?? A.areas.defense[0]?.id;
    if (dropId) consumeDice(g, A, 'defense', [dropId]);
    delete dec[skill.id];
    // ③ 计数 +1（≤ 上限），并同步「锋芒」加成
    const cap = card.countCap ?? Number.POSITIVE_INFINITY;
    g.challenge.count = Math.min(cap, g.challenge.count + 1);
    syncLegendFengmang(g);
    logLine(g, `「${card.legacy}」：${skill.name} — 弃置挑战者 1 个防御骰，计数 +1`);
    g.challenge.deferred = undefined;
    return;
  }
  g.challenge.deferred = undefined;
}

/**
 * 从 `g.challenge.resumeAt` 继续逐条结算；遇"发起攻击/代决"就记下续跑点并返回。
 * `once = true`（界面按节奏派发 `challengeStep`）→ **只结算"一条真正要执行的技能"**就返回，让每条都看得见。
 *
 * **顺序＝卡面文字顺序**；每条技能固定前缀：①（界面）弹技能名 ② 驱动骰：临时区 → 驱动骰槽 → 消失
 * → ③ 再按卡面逐步执行（该步的代决在**它该发生的那一步**才弹）。
 */
function continueLegendTurn(g: GameState, once = false): void {
  const card = CHALLENGES.find((c) => c.id === g.challenge?.cardId);
  if (!g.challenge || !card || !card.skills) {
    endTurn(g);
    return;
  }
  const legacy = card.legacy;
  // 「延后一步」先收尾（例：暗夜凶神＝攻击结算后 弃骰 + 计数）
  if (g.challenge.deferred) {
    resolveLegendDeferred(g, card);
    return; // 本步只做这一件事；下一次 challengeStep 再继续
  }
  g.challenge.resumeAt = g.challenge.resumeAt ?? 0;
  for (let i = g.challenge.resumeAt; i < card.skills.length; i++) {
    if (g.pendingAttack) return; // 正在等挑战者响应
    const skill = card.skills[i];
    // 纯被动（如「锋芒」＝按计数加伤害）：**不占"逐条结算"的步**，内部同步即可
    if (skill.passive) {
      applyChallengeSkill(g, card, skill, []);
      continue;
    }
    if (skill.marker === '怜悯*' && g.challenge.turn === 0) {
      logLine(g, `「${legacy}」：${skill.name} — 首次回合（怜悯*），跳过`);
      continue;
    }
    // 本条消耗的驱动骰：代决暂停期间**已扣下并记住** → 续跑时直接取回（不重算槽匹配，否则骰子已不在 driven 里）
    const resuming = g.challenge.pendingSkillId === skill.id && !!g.challenge.pendingConsumed;
    let consumed: Die[] = [];
    if (resuming) {
      consumed = g.challenge.pendingConsumed!.map((x) => ({ id: x.id, value: x.value, kind: 'meditation' }));
    } else if (skill.slots && skill.slots.length > 0) {
      const m = matchSlots(skill.slots, g.challenge.driven);
      if (!m) {
        logLine(g, `「${legacy}」：${skill.name} — 驱动骰不足，跳过`);
        continue;
      }
      consumed = g.challenge.driven.filter((d) => m.includes(d.id));
    }
    // 代决（模式 1）：本条需要的选择还没收集齐 → **先把骰子扣下、发第一步动效**，再挂代决
    const wants = challengeDecisions(g, skill, consumed.length);
    const dec = (g.challenge.decisions ??= {});
    const got = dec[skill.id] ?? [];
    if (wants.length > got.length) {
      g.challenge.activeSkill = i;
      g.challenge.resumeAt = i;
      if (!resuming) {
        g.challenge.driven = g.challenge.driven.filter((d) => !consumed.includes(d)); // 真正扣掉
        // ⚠️ **不写 `slot`**：驱动骰槽只是界面上的"过场" → 那几颗骰由界面影子演「临时区→中间→槽→消失」，
        //    状态里**不留**（否则界面会露出真骰、之后还要再演一次"从槽飞走"）。记账靠 `pendingConsumed`。
        g.challenge.pendingConsumed = consumed.map((d) => ({ id: d.id, value: d.value }));
        g.challenge.pendingSkillId = skill.id;
        // 动效旁路：**先动画（技能名 + 驱骰进槽）**，选择面板由界面延后到动画播完再显示
        fxPush({
          kind: 'legendSkill',
          player: 'B',
          skillKey: skill.id,
          skillName: skill.name,
          consumed: consumed.map((d) => ({ id: d.id, value: d.value })),
          spawn: [],
          outIds: [],
          attack: false,
        });
      }
      const w = wants[got.length];
      g.pending = { kind: 'challengePick', player: 'A', prompt: w.prompt, options: w.options };
      return;
    }
    g.challenge.driven = g.challenge.driven.filter((d) => !consumed.includes(d)); // 真正扣掉
    g.challenge.slot = []; // 驱动骰槽＝纯过场视觉，状态里不留骰
    g.challenge.activeSkill = i; // 界面高亮"正在结算"
    g.challenge.pendingConsumed = undefined;
    g.challenge.pendingSkillId = undefined;
    const fxConsumed = resuming ? [] : consumed.map((d) => ({ id: d.id, value: d.value })); // 代决帧已报过 → 不重复
    const res = applyChallengeSkill(g, card, skill, consumed);
    // 动效旁路：本步的编排依据（新产生的骰 / 是否触发攻击；消耗已在代决帧报过）
    fxPush({
      kind: 'legendSkill',
      player: 'B',
      skillKey: skill.id,
      skillName: skill.name,
      consumed: fxConsumed,
      spawn: res.spawn,
      outIds: res.outIds,
      attack: !!(g.pendingAttack || g.virtualQueue),
    });
    delete dec[skill.id];
    g.challenge.slot = [];
    if (g.pendingAttack || g.virtualQueue) {
      g.challenge.resumeAt = i + 1; // 等挑战者响应完再续
      return;
    }
    if (skill.endsTurn) {
      logLine(g, `「${legacy}」：${skill.name} — 立即结束回合`);
      break;
    }
    if (once) {
      g.challenge.resumeAt = i + 1; // 只结算一条 → 交回界面，等下一次 challengeStep
      return;
    }
  }
  g.challenge.driven = [];
  g.challenge.slot = [];
  g.challenge.resumeAt = null;
  g.challenge.activeSkill = null;
  g.challenge.turn += 1;
  endTurn(g); // 交回合给挑战者（其 beginTurn 走正常流程）
}

export function beginTurn(g: GameState): void {
  if (g.phase === 'gameOver') return;
  // 单人挑战：轮到传奇 → 不按常规阶段，直接跑它的"自动机回合"
  if (g.mode === 'challenge' && g.activePlayer === 'B') {
    runLegendTurn(g);
    return;
  }
  const p = g.activePlayer;
  // 战术牌 T05「狂热」：该玩家**自己的回合**计数 +1（封顶 4；L04 重开清零）——"前 3 个回合"判定用
  g.players[p].turnsTaken = Math.min(4, g.players[p].turnsTaken + 1);
  // 先切入新回合的起始阶段，再打「回合开始」战报：让该行日志携带新回合的阶段标签
  //（首回合 = 尘起、其后 = 重掷），否则会带上上一回合遗留的标签（初始重掷 / 结束）
  // 战术牌 T11「迷烟」：你自己的**第一个回合仍具有重掷阶段**（首回合本来跳过重掷）
  const t11 = TACTIC_BY_ID[g.players[p].tactic ?? '']?.key === 'miyan';
  g.phase = g.firstRound[p] && !t11 ? 'dustRise' : 'reroll';
  // T11「迷烟」：首回合本应跳过重掷，是它**多给了一段"重掷阶段"** → 弹「迷烟」
  if (g.firstRound[p] && t11) fxTacticFired(g, p);
  logLine(g, `${pname(p)} 的回合开始`);
  g.pendingAttack = null;
  g.pending = null;
  g.unblockableThisTurn = false;
  g.caiyuliuUsed = 0;
  g.dustRiseNormalCount = 0;
  g.dustRiseActed = false;
  g.freeDustRise = 0;
  g.rerollUsed = 0;
  g.skillsUsedThisTurn = [];
  g.skillConsumedThisAction = 0;
  g.dunwuPulseUsedThisTurn = false;
  g.attackQueue = null;
  g.virtualQueue = null;
  g.extraReroll = null;
  g.pendingQueue = [];
  // 019 尘哀·尘起：每回合最多触发 1 次；其赠予的「免费额外尘起」也在回合开始时清零
  g.chenaiUsed.A = false;
  g.chenaiUsed.B = false;
  g.freeNoCostRise = 0;
  // 025 屠虎·横贯（持续）：每回合的攻击次数清零（第 2 次攻击伤害 +2 按本回合统计）
  g.attacksThisTurn.A = 0;
  g.attacksThisTurn.B = 0;
  g.hunhunGained.A = 0;
  g.hunhunGained.B = 0;
  // A07 异相·完杀必杀：「直到本回合结束前双方持续式失效」——回合开始清除该临时标记
  // 注：L09「遍野残杀」的「左右两侧视为激活」**不在回合开始清除**（常驻，直到其"回合结束即死"触发）。
  for (const id of ['A', 'B'] as PlayerId[]) {
    for (const a of g.players[id].artifacts) {
      a.continuousLostThisTurn = false;
    }
    if (g.players[id].legend) g.players[id].legend!.continuousLostThisTurn = false;
  }
  // 028 天罚（激活·本回合）：攻击点数视为固定值 / 只能用某类骰抵挡 / 造成伤害次数统计，均按本回合清零
  g.tianfa.A = null;
  g.tianfa.B = null;
  // 018 至黑：每回合第一次受伤的判定在每回合开始时重置（任何玩家的回合开始时都重置，双方各自独立）
  g.players.A.damagedThisTurn = false;
  g.players.B.damagedThisTurn = false;
  // L08 蛇蝎之泪：本回合「填弹」实际叠加的计数累计 —— 每次回合开始都清零（双方）
  g.players.A.tiandanGainedThisTurn = 0;
  g.players.B.tiandanGainedThisTurn = 0;
  // L01 断苇一斩：判定"我上一个回合是否一整个回合都没造成任何伤害"，随后重置本回合标记
  // （首个回合没有"上一个回合"→ 不可发动）
  g.players[p].noDamageLastTurn = !g.firstRound[p] && !g.players[p].dealtDamageThisTurn;
  g.players[p].dealtDamageThisTurn = false;
  // 回合开始触发（补充之前，故获得的骰计入意志上限）：008 战车
  applyTurnStartEffects(g, p);
  // 战术牌 T08「无情」：对方的回合开始时（补充骰之前），若任一方生命 ≤20 → 本回合玩家受 2 真伤
  checkWuqing(g, p);
  if ((g.phase as string) === 'gameOver') return;
  // 战术牌 T15「影子」：你自己的**第一个回合开始时** → 为战术上的存放骰选定点数（1–6）
  if (
    g.firstRound[p] &&
    TACTIC_BY_ID[g.players[p].tactic ?? '']?.key === 'yingzi' &&
    !g.players[p].tacticHeldDie &&
    !g.players[p].tacticOnceUsed
  ) {
    queuePending(g, { kind: 'yingziPick', player: p });
    pumpPending(g);
  }
  if (g.firstRound[p]) {
    // 第一回合跳过补充与重掷
    // 027 凛冽之音：持续到「持有者自己的下个尘起阶段开始」→ 尘起阶段开始时清除
    g.rerollPunish[p] = false;
  } else {
    let refilled = 0;
    withRng(g, (rng) => {
      refilled = refillPhase(g, p, rng);
    });
    // 010 深红·杀意：补充阶段实际补充数量 ≤ 3 时，可造成 3 点真实伤害并回复 2 点生命
    if (hasActiveSkill(g.players[p], 'shenhong.kill') && refilled <= 3) {
      g.pending = { kind: 'shenhongKill', player: p };
    }
    // A02 深红（异相）·哀悼：补充阶段实际补充数量 ≤ 3 时，可造成 2 点真实伤害并弃置对方 1 个防御骰
    if (hasActiveSkill(g.players[p], 'shenhong.alt.aidao') && refilled <= 3) {
      queuePending(g, { kind: 'aidao', player: p });
      pumpPending(g);
    }
    // 029 真言·全知（持续）：补充阶段不按常规分布落区，改由玩家自行分配全部能力骰
    if (hasActiveSkill(g.players[p], 'zhenyan.quanzhi')) {
      queuePending(g, { kind: 'quanzhiAssign', player: p });
      pumpPending(g);
    }
  }
  // 战术牌 T07「保守」：回合开始时也检查（从第一回合起，防御骰第一次为空即触发）
  checkBaoshou(g);
}

export function endTurn(g: GameState): void {
  if (g.phase === 'gameOver') return;
  const p = g.players[g.activePlayer];
  // L09 传奇面板·遍野残杀：你的回合结束时，你**立即死亡**（直接判负，不走伤害流程）
  if (p.artifacts.some((a) => a.allSidesActiveThisTurn === true)) {
    logLine(g, `${pname(g.activePlayer)} 「遍野残杀」：回合结束 → 立即死亡`);
    const before = p.life;
    p.life = 0;
    noteLifeDrop(g, g.activePlayer, before - p.life); // L11 邪灵序曲：直接设 0 也是"生命下降"
    checkLifeEnd(g);
    if ((g.phase as string) === 'gameOver') return; // 已判负：不再继续正常交回合
  }
  // 015 残响·持续：每当你的回合结束时，本神器计数下降 1 点（最低 0；充能层数不受影响）
  const cx = p.artifacts.find((a) => a.skills.some((s) => s.key === 'canxiang.juejing'));
  if (cx && hasActiveSkill(p, 'canxiang.juejing') && cx.count > 0) {
    const before = cx.count;
    cx.count -= 1;
    logLine(g, `「${cx.name}」：回合结束，计数 ${before} → ${cx.count}`);
  }
  // 023 蛇蝎·畏惧：该玩家「下个回合」的攻击伤害减半 → 其回合结束时清除（即使本回合没攻击/被抵挡也不保留）
  p.attackHalvedNextTurn = false;
  p.buffs = p.buffs.filter((b) => b.duration !== 'thisTurn');
  // 027 寒光·必杀：置于神器上的骰子在该玩家回合结束时移除
  const hanguang = p.artifacts.find((a) => a.skills.some((s) => s.key === 'hanguang.ultimate'));
  if (hanguang) hanguang.heldDice = [];
  g.firstRound[g.activePlayer] = false;
  g.activePlayer = g.activePlayer === 'A' ? 'B' : 'A';
  g.turnIndex += 1;
  beginTurn(g);
}

/** 「推进阶段」的唯一入口：初始重掷 → 走初始重掷步；其余 → `advancePhase`。
 *  供 `advance` 动作与「自动推进」（见 `autoAdvanceAction`）共用，保证阶段口径一致。 */
function doAdvance(g: GameState): void {
  if (g.phase === 'initialReroll') finishInitialRerollStep(g);
  else advancePhase(g);
}

/**
 * 「没得做就自动翻页」：判断当前阶段是否**确实没有任何可做之事**，是则返回 `{t:'advance'}`。
 *
 * - **初始重掷**：持 T01「谨慎」（卡面：没有初始重掷步骤）或没有任何能力骰。
 * - **重掷阶段**：重掷次数已用尽（默认 1；002「龙游万象」→2；013 雷暴插入的额外阶段→1）或无骰可重掷。
 *   **首回合由 T11「迷烟」带入的重掷阶段同样适用**（有骰就正常停下等重掷，无骰才跳过）。
 * - **尘起阶段**：`dustRiseActions` 为空＝没有任何可用的尘起途径。
 *   （**尘印 / 019 免费尘起 / T12「激进」都算"还能尘起"** → 动作列表非空 → 不会自动结束。）
 * - 有 `pending` / 待抵挡 / 多段攻击队列时一律**不**自动推进（让位待决策）。
 *
 * 纯读、不改状态。**必须在 `checkBaoshou`（T07「保守」补骰）之后调用**：否则会把"刚获得冥想骰、
 * 其实能尘起"的阶段误判为空。
 */
export function autoAdvanceAction(g: GameState): Action | null {
  if (g.phase === 'gameOver') return null;
  if (g.pending || g.pendingQueue.length > 0 || g.pendingAttack) return null;
  const p = g.players[g.activePlayer];
  if (g.phase === 'initialReroll') {
    const noStep = TACTIC_BY_ID[p.tactic ?? '']?.key === 'qingzhen';
    return noStep || totalDice(p) === 0 ? { t: 'advance' } : null;
  }
  if (g.phase === 'reroll') {
    const allowance = g.extraReroll ? 1 : rerollAllowance(p);
    const canReroll = g.rerollUsed < allowance && effectiveSpeed(p) > 0 && totalDice(p) > 0;
    return canReroll ? null : { t: 'advance' };
  }
  if (g.phase === 'dustRise') {
    return dustRiseActions(g, g.activePlayer).length === 0 ? { t: 'advance' } : null;
  }
  return null;
}

export function advancePhase(g: GameState): void {
  if (g.phase === 'gameOver') return;
  switch (g.phase) {
    case 'reroll': {
      if (g.extraReroll) {
        // 额外重掷阶段结束：把行动权交还原玩家，继续其尘起阶段
        const reroller = g.extraReroll.player;
        const resume = g.extraReroll.resume;
        g.extraReroll = null;
        g.activePlayer = resume;
        g.phase = 'dustRise';
        // 027 凛冽之音：持续到「持有者自己的下个尘起阶段开始」→ 此处（其尘起阶段开始）清除
        g.rerollPunish[resume] = false;
        logLine(g, `额外重掷阶段结束，${pname(resume)} 继续尘起阶段`);
        // 026 哀歌·陷阵：额外重掷阶段结束同样构成「你的重掷阶段结束」→ 与普通路径同一口径
        queueXianzhen(g, reroller);
        // 017 帷幕：该额外重掷阶段结束时同样触发（FAQ 17.1.2）；不再触发 013 以免循环
        queueRerollEndTriggers(g, reroller, { includeLeibao: false });
        pumpPending(g);
        break;
      }
      // 先离开重掷阶段再处理触发，避免待决策解算完后重复触发
      g.phase = 'dustRise';
      // 027 凛冽之音：持续到「持有者自己的下个尘起阶段开始」→ 此处（其尘起阶段开始）清除
      // （注意：重掷阶段在本阶段**之前**，所以此时清除不会漏掉本轮重掷的惩罚）
      g.rerollPunish[g.activePlayer] = false;
      // 026 哀歌·陷阵：**重掷者自己的**重掷阶段结束时（与额外重掷路径共用同一实现）
      queueXianzhen(g, g.activePlayer);
      // 对方（非当前玩家）的重掷阶段结束时触发：013 雷暴·持续 / 017 帷幕
      queueRerollEndTriggers(g, g.activePlayer);
      pumpPending(g);
      break;
    }
    case 'dustRise':
      // 单人挑战「不存在尘落」（说明书 page_15）→ 不尘起也不 +1、不判 10 层胜
      if (g.mode !== 'challenge' && !g.dustRiseActed) {
        const before = g.dustfall;
        const player = g.activePlayer;
        incrementDustfall(g);
        logLine(g, `${pname(player)} 未进行尘起行动，尘落 ${before} → ${g.dustfall}`);
        if ((g.phase as string) === 'gameOver') {
          logLine(g, `尘落达到 10，游戏结束：${pname(g.winner ?? g.activePlayer)} 获胜`);
          break;
        }
      }
      g.phase = 'main';
      // 035 千劫·万丈明光（持续）：你的主要阶段开始时，弃置 2 个能力骰
      if (
        hasActiveSkill(g.players[g.activePlayer], 'qianjie.wanzhang') &&
        totalDice(g.players[g.activePlayer]) > 0
      ) {
        queuePending(g, { kind: 'wanzhangDiscard', player: g.activePlayer });
      }
      break;
    case 'main':
      // 先离开主要阶段（避免待决策解算完后重复触发），再排队「主要阶段结束 / 回合结束」的待决策
      g.phase = 'end';
      // L09 传奇面板·鏖战（持续）：**你的主要阶段结束时**，若你有能力骰且「陷阵」处于激活状态 → 再次执行 1 次「陷阵」。
      // 顺序（2026-09-28 用户确认）：**鏖战 → 033 → 意志上限弃骰**（后两者会先减骰子，若排在前面会把鏖战"饿死"）。
      if (hasActiveSkill(g.players[g.activePlayer], 'lifeng.aozhan')) {
        // 仅当「陷阵」**真的排队**（已激活 + 有骰可弃）时才弹「鏖战」技能名——否则只发日志、不弹气泡
        if (queueXianzhen(g, g.activePlayer, 'mainEnd')) fxSkillFired(g, g.activePlayer, 'lifeng.aozhan');
      }
      // 032 梦魇·低语（持续）：持有者自己的主要阶段结束时，宣称 1 个能力骰类型
      if (hasActiveSkill(g.players[g.activePlayer], 'mengyan.diyu')) {
        queuePending(g, { kind: 'kuyu', player: g.activePlayer });
      }
      // L11 传奇面板·邪灵序曲（持续）：**你的回合结束时**，造成＝「邪灵序曲」计数**十位数**的真实伤害给对手。
      // 顺序（2026-09-28 用户确认）：**（主要阶段结束：L09 鏖战 → 032 低语）→ 邪灵序曲 → 033 → 意志上限弃骰**。
      if (hasActiveSkill(g.players[g.activePlayer], 'aiwa.xielingxuqu')) {
        const lg = g.players[g.activePlayer].legend;
        const dmg = lg ? Math.floor(lg.count / 10) : 0;
        if (dmg > 0) {
          const oppId: PlayerId = g.activePlayer === 'A' ? 'B' : 'A';
          logLine(
            g,
            `${pname(g.activePlayer)} 「邪灵序曲」：回合结束 → 计数 ${lg ? lg.count : 0} 的十位数 ${dmg} → 对 ${pname(oppId)} 造成等量真实伤害`,
          );
          if (lg) fxSetSource({ player: g.activePlayer, artifactId: lg.id, side: 'only', skillKey: 'aiwa.xielingxuqu' });
          dealTrueDamage(g, oppId, dmg, g.activePlayer);
        }
      }
      // 邪灵序曲若把对手打死 → 直接结束（不再走 033 / 意志上限）
      if ((g.phase as string) === 'gameOver') break;
      // 033 凋零·死亡亦逝（持续）：任一方生效时，双方各自回合结束时都要执行；区域为空则自动通过
      if (
        (['A', 'B'] as PlayerId[]).some((id) => hasActiveSkill(g.players[id], 'diaoling.siwang')) &&
        totalDice(g.players[g.activePlayer]) > 0
      ) {
        queuePending(g, { kind: 'tiaolingPick', player: g.activePlayer });
      }
      // 结束阶段：超出意志上限时，由当前回合玩家**自行选择**弃置哪几颗（说明书 page_09；排在 032/033 之后）
      if (totalDice(g.players[g.activePlayer]) > effectiveWill(g.players[g.activePlayer])) {
        queuePending(g, { kind: 'endDiscard', player: g.activePlayer });
      }
      pumpPending(g);
      finalizeTurnEnd(g);
      break;
    case 'end':
      finalizeTurnEnd(g);
      break;
    default:
      break;
  }
}

/** 「回合结束」结算：先跑结束阶段（弃多余）再交出回合；仅在「结束」阶段、且无任何待决策时执行 */
function finalizeTurnEnd(g: GameState): void {
  if (g.phase !== 'end') return;
  if (g.pending || g.pendingQueue.length > 0) return;
  endPhase(g, g.activePlayer);
  logLine(g, `${pname(g.activePlayer)} 回合结束`);
  endTurn(g);
}

/** 立即结束当前的主要阶段（供 009 必杀等使用） */
export function endMainPhase(g: GameState): void {
  if (g.phase === 'main') advancePhase(g);
}

export function createGame(opts: SetupOptions): GameState {
  const g = setupGame(opts);
  if (opts.tactics) {
    enterTacticsPhase(g);
  } else if (opts.tacticA || opts.tacticB) {
    // 构筑/挑战＝设置页**直接指定**战术牌：进"战前"阶段承载其"战斗开始时"交互（T01 选骰 / T02 先手）
    g.phase = 'tactics';
    for (const id of ['A', 'B'] as PlayerId[]) applyTacticStart(g, id);
    pumpPending(g);
    maybeEnterInitialReroll(g);
  } else {
    enterInitialReroll(g);
  }
  // 收口：初始状态也不该停在"没有任何可做之事"的阶段（如 L03「无敌」无初始能力骰、T01「谨慎」无初始重掷步骤）
  settleAutoAdvance(g);
  return g;
}

/** 建局收口：反复自动推进，直到没有"没得做"的阶段（见 `autoAdvanceAction`）。 */
function settleAutoAdvance(g: GameState): void {
  for (let guard = 0; guard < 6; guard++) {
    if (!autoAdvanceAction(g)) break;
    doAdvance(g);
  }
}

export interface ChallengeSetupOptions {
  seed: number;
  /** 挑战卡 id（如 'Z02'） */
  cardId: string;
  /** 挑战者（A）构筑的 3 件神器（第一/二/三列） */
  challenger: [string, string, string];
  /** 挑战者的战术牌（可空） */
  tactic?: string;
}

/** 单人挑战建局：挑战者＝A（构筑），传奇＝B（挑战卡预设，无能力骰、生命取卡面、先手）。 */
export function createChallengeGame(opts: ChallengeSetupOptions): GameState {
  const card = CHALLENGES.find((c) => c.id === opts.cardId);
  if (!card) throw new Error(`unknown challenge card: ${opts.cardId}`);
  const g = setupGame({
    seed: opts.seed,
    firstPlayer: 'B', // 说明书：永远从「昔日传奇」回合开始
    heroA: opts.challenger,
    heroB: card.artifacts,
    tacticA: opts.tactic,
  });
  g.mode = 'challenge';
  // 传奇没有初始能力骰（它的骰是每回合投的"驱动骰"），也没有冥想骰区
  g.players.B.areas = { attack: [], defense: [], meditation: [] };
  if (card.life != null) g.players.B.life = g.players.B.lifeMax = card.life;
  g.challenge = { cardId: card.id, count: 0, driven: [], slot: [], turn: 0 };
  logLine(g, `挑战模式：对手＝传说中的「${card.legacy}」（${card.id}）· 生命 ${g.players.B.life}`);
  // 挑战者的战术牌：构筑直接生效
  if (opts.tactic) applyTacticStart(g, 'A');
  // 挑战者仍需初始重掷（传奇无骰 → 它那一步会被自动跳过）
  enterInitialReroll(g);
  settleAutoAdvance(g);
  return g;
}

/** 进入「初始重掷」（战前管线的最后一步） */
function enterInitialReroll(g: GameState): void {
  const second: PlayerId = g.firstPlayer === 'A' ? 'B' : 'A';
  g.phase = 'initialReroll';
  g.activePlayer = g.firstPlayer;
  g.initialRerollQueue = [g.firstPlayer, second];
  logLine(g, `${pname(g.firstPlayer)} 先手；初始重掷：可重掷任意数量的初始能力骰`);
}

/** 战术牌·战前抽牌：进入 `tactics` 阶段，先给先手抽 2 张（另一人待其选完再从剩余池抽 → 双方不同名） */
function enterTacticsPhase(g: GameState): void {
  const second: PlayerId = g.firstPlayer === 'A' ? 'B' : 'A';
  g.phase = 'tactics';
  g.activePlayer = g.firstPlayer;
  g.tacticPool = TACTIC_POOL.slice();
  g.tacticQueue = [g.firstPlayer, second];
  drawNextTacticHand(g);
}

/** 给队首（`tacticQueue[0]`）从剩余池抽 2 张并移出池（保证双方不选到同一张），写战报 */
function drawNextTacticHand(g: GameState): void {
  const who = g.tacticQueue[0];
  if (!who) { g.tacticHand = []; return; }
  const hand: string[] = [];
  withRng(g, (rng) => {
    for (let i = 0; i < 2 && g.tacticPool.length > 0; i++) {
      hand.push(g.tacticPool.splice(rng.int(g.tacticPool.length), 1)[0]);
    }
  });
  g.tacticHand = hand;
  logLine(
    g,
    `${pname(who)} 战术牌：抽到${hand.map((id) => `「${TACTIC_BY_ID[id]?.name ?? id}」`).join('、')}（留 1 张）`,
  );
}

/**
 * 战术牌"战斗开始时"交互挂载：战术牌**定下时**调用（构筑带入 / 预设·轮选抽到后 / L04 重开重跑 T01）。
 * 只挂**交互待决策**（T01 选点 / T02 先手）；**生命修正**不在这里——它们要等双方都定好、在战前收口统一结算。
 *
 * ⚠️ L04 重开只重跑**触发时点 ≥「获得初始能力骰子」**的战术牌（见 `TacticDef.reOnReset`）；调用方自行过滤。
 */
export function applyTacticStart(g: GameState, player: PlayerId): void {
  const id = g.players[player].tactic;
  if (!id) return;
  const key = TACTIC_BY_ID[id]?.key;
  if (key === 'qingzhen') {
    // L03「无敌」＝没有初始能力骰 → 与 T01 同人时**无敌优先**（无骰可选）
    if (hasActiveSkill(g.players[player], 'batton.wudi')) return;
    g.players[player].areas.attack = [];
    g.players[player].areas.defense = [];
    g.players[player].areas.meditation = [];
    queuePending(g, { kind: 'tacticDice', player });
  } else if (key === 'xianji') {
    queuePending(g, { kind: 'tacticFirst', player });
  } else if (key === 'yuanjian') {
    // T13「远见」：战斗开始时猜测"生命最先降为 20 点或以下"的玩家
    queuePending(g, { kind: 'tacticGuess', player });
  }
}

/** 战术牌生命修正（战前收口一次）：**先「+生命」取最大 → 再「−生命」取最大**，同时改生命上限 */
function applyTacticLifeMods(g: GameState): void {
  for (const id of ['A', 'B'] as PlayerId[]) {
    // 收集该玩家受到的生命修正贡献（来源战术牌名 + 数值；按来源 A→B 顺序）；+ 与 − 各取一笔生效
    let posBest: { name: string; amount: number } | null = null;
    let negBest: { name: string; amount: number } | null = null;
    for (const src of ['A', 'B'] as PlayerId[]) {
      const t = g.players[src].tactic;
      if (!t) continue;
      const def = TACTIC_BY_ID[t];
      if (!def) continue;
      const name = def.name ?? t;
      for (const lm of def.lifeMods) {
        const target: PlayerId = lm.who === 'self' ? src : src === 'A' ? 'B' : 'A';
        if (target !== id) continue;
        // 方向由 `who` 决定（amount 一律存正数）：self＝提高 / opp＝降低
        if (lm.who === 'self') {
          if (!posBest || lm.amount > posBest.amount) posBest = { name, amount: lm.amount };
        } else if (!negBest || lm.amount < negBest.amount) {
          negBest = { name, amount: lm.amount }; // 多条 − 取"数值最大"（最接近 0）
        }
      }
    }
    if (!posBest && !negBest) continue; // 无任何贡献 → 不写战报
    const delta = (posBest?.amount ?? 0) - (negBest?.amount ?? 0);
    const p = g.players[id];
    p.life += delta;
    p.lifeMax += delta;
    // 静默同步"生命十位数基准"（L05 复仇之灵用）；战前阶段**不触发** checkLifeTens（避免误引发额外尘起）
    p.lifeTens = Math.floor(p.life / 10);
    // 战报始终反映结果（含净 0，如 +2 再 −2）；列出实际生效的来源
    const parts: string[] = [];
    if (posBest) parts.push(`「${posBest.name}」+${posBest.amount}`);
    if (negBest) parts.push(`「${negBest.name}」−${negBest.amount}`);
    const suffix = delta === 0 ? '（不变）' : '';
    logLine(
      g,
      `${pname(id)} 战术牌·初始生命修正：${parts.join('、')} → 生命 ${p.life}／上限 ${p.lifeMax}${suffix}`,
    );
  }
}

/** 战前收口：抽牌完、无待决策 → 结算战术牌生命修正（一次）并进入初始重掷 */
function maybeEnterInitialReroll(g: GameState): void {
  if (g.phase !== 'tactics') return;
  if (g.tacticQueue.length > 0) return;
  if (g.pending || g.pendingQueue.length > 0) return;
  if (!g.tacticStartDone) {
    applyTacticLifeMods(g);
    g.tacticStartDone = true;
  }
  enterInitialReroll(g);
}

/**
 * 战术牌横条三态（**单一来源**；`render.ts` 的战术牌横条只读它）：
 * - `active`（绿·生效中）：T05 前 3 回合 / T06 对方血≤13 / T04 有就绪必杀 / T08 任一方血≤20；
 * - `spent`（灰·已用尽）：T01/T02/T03（开局类）、T05 过前 3 回合、T07 已触发（整局 1 次）；
 * - `normal`：其余。
 */
export type TacticBarState = 'active' | 'spent' | 'normal';
export function tacticBarState(g: GameState, player: PlayerId): TacticBarState {
  const def = TACTIC_BY_ID[g.players[player].tactic ?? ''];
  if (!def) return 'normal';
  const p = g.players[player];
  const active =
    tacticActiveBonus(g, player) !== null ||
    // T05「狂热」：仍在前 3 个回合内 → 横条常绿（**不看是否轮到自己**；否则对方回合会闪成普通灰）
    (def.key === 'kuangre' && p.turnsTaken >= 1 && p.turnsTaken <= 3) ||
    (def.key === 'molu' && hasReadyUltimate(g, player)) ||
    (def.key === 'wuqing' && (g.players.A.life <= 20 || g.players.B.life <= 20)) ||
    (def.key === 'cibei' && !p.tacticOnceUsed) ||
    (def.key === 'baoshou' && !p.tacticOnceUsed) ||
    (def.key === 'yuhui' && !p.tacticOnceUsed) ||
    (def.key === 'fuhuo' && !p.tacticOnceUsed) ||
    (def.key === 'yingzi' && !p.tacticOnceUsed) ||
    // T17「诱敌」：未发动＝绿（待命）
    (def.key === 'youdi' && !p.tacticOnceUsed) ||
    // T18「适应」：未用＝绿（待命）
    (def.key === 'shipei' && !p.tacticOnceUsed) ||
    // T16「潜伏」（全局）：当前回合玩家的第 1 或第 2 个回合期间＝生效中
    (def.key === 'qianfu' &&
      (g.firstRound[g.activePlayer] || g.players[g.activePlayer].turnsTaken === 2)) ||
    (def.key === 'miyan' && g.firstRound[player]) ||
    (def.key === 'jijin' && g.firstRound[player] && !p.tacticOnceUsed) ||
    // T13「远见」：尚未有人降到 ≤20（待命）＝生效中
    (def.key === 'yuanjian' && g.tacticLowFirst === null);
  if (active) return 'active';
  if (def.setupOnly) return 'spent';
  if (def.key === 'kuangre' && p.turnsTaken > 3) return 'spent';
  if (def.key === 'baoshou' && p.tacticOnceUsed) return 'spent';
  if (def.key === 'cibei' && p.tacticOnceUsed) return 'spent';
  if (def.key === 'yuhui' && p.tacticOnceUsed) return 'spent';
  if (def.key === 'fuhuo' && p.tacticOnceUsed) return 'spent';
  if (def.key === 'yingzi' && p.tacticOnceUsed) return 'spent';
  if (def.key === 'youdi' && p.tacticOnceUsed) return 'spent';
  if (def.key === 'shipei' && p.tacticOnceUsed) return 'spent';
  if (def.key === 'miyan' && !g.firstRound[player]) return 'spent';
  if (def.key === 'jijin' && (p.tacticOnceUsed || !g.firstRound[player])) return 'spent';
  if (def.key === 'yuanjian' && g.tacticLowFirst !== null) return 'spent';
  return 'normal';
}

/**
 * 战术牌 T07「保守」：**从游戏的第一个回合起**，当某玩家**防御骰区第一次为空**时，立即获得
 * 1 个随机点数防御骰 + 1 个随机点数冥想骰（整局 1 次）。在**每次行动结算后**与**每个回合开始时**检查。
 */
function checkBaoshou(g: GameState): void {
  if (g.phase === 'gameOver') return;
  if (g.turnIndex < 1) return; // 「从游戏的第一个回合开始」→ 战前不检查
  for (const id of ['A', 'B'] as PlayerId[]) {
    const p = g.players[id];
    if (TACTIC_BY_ID[p.tactic ?? '']?.key !== 'baoshou') continue;
    if (p.tacticOnceUsed) continue;
    if (p.areas.defense.length !== 0) continue;
    p.tacticOnceUsed = true;
    fxTacticFired(g, id);
    withRng(g, (rng) => {
      const d1 = gainRandomDice(g, id, 'defense', 1, rng)[0];
      const d2 = gainRandomDice(g, id, 'meditation', 1, rng)[0];
      logLine(
        g,
        `${pname(id)} 「保守」：防御骰第一次为 0 → 获得 1 个随机防御骰（${d1.value}）与 1 个随机冥想骰（${d2.value}）`,
      );
    });
  }
}

/**
 * 战术牌 T08「无情」：**对方的回合开始时**（`turnStarter` ＝本回合玩家），若**任一方生命 ≤20**，
 * 则本回合玩家受到 2 点真实伤害（source＝持有者）。每个对方回合均可再次触发。
 */
function checkWuqing(g: GameState, turnStarter: PlayerId): void {
  if (g.phase === 'gameOver') return;
  const holder: PlayerId = turnStarter === 'A' ? 'B' : 'A';
  if (TACTIC_BY_ID[g.players[holder].tactic ?? '']?.key !== 'wuqing') return;
  if (g.players.A.life > 20 && g.players.B.life > 20) return;
  logLine(g, `${pname(holder)} 「无情」：有玩家生命 ≤20 → ${pname(turnStarter)} 受到 2 点真实伤害`);
  fxTacticFired(g, holder);
  dealTrueDamage(g, turnStarter, 2, holder);
}

/** 跳过后手/先手的初始重掷，进入先手第一回合（供快速开始/测试） */
export function skipInitialReroll(g: GameState): void {
  let guard = 0;
  while (g.phase === 'initialReroll' && guard++ < 4) applyAction(g, { t: 'advance' });
}

function finishInitialRerollStep(g: GameState): void {
  g.initialRerollQueue.shift();
  if (g.initialRerollQueue.length > 0) {
    g.activePlayer = g.initialRerollQueue[0];
    logLine(g, `${pname(g.activePlayer)} 进行初始重掷`);
  } else {
    g.activePlayer = g.firstPlayer;
    g.turnIndex += 1; // T0 专属初始重掷；首个玩家回合从 T1 起（与 endTurn / L11 的自增口径一致）
    beginTurn(g);
  }
}

/** L05 复仇之灵：**强制**的一次"无需冥想骰的额外尘起行动"（不占次数、不耗 freeNoCostRise） */
function fuchouRiseActions(g: GameState, player: PlayerId): Action[] {
  const p = g.players[player];
  const acts: Action[] = [];
  for (const a of p.artifacts) {
    if (!canTargetForDustRise(a)) continue;
    const sides =
      a.column === 3
        ? [undefined]
        : a.activeMarkerSide == null
          ? ['left', 'right']
          : [a.activeMarkerSide === 'left' ? 'right' : 'left'];
    for (const side of sides) {
      acts.push({
        t: 'dustRise',
        artifactId: a.id,
        free: true,
        fuchou: true,
        ...(side ? { side: side as 'left' | 'right' } : {}),
      });
    }
  }
  return acts;
}

function dustRiseActions(g: GameState, player: PlayerId): Action[] {
  const p = g.players[player];
  const acts: Action[] = [];
  // 尘起 = 「使用 1 个冥想骰」→ 走统一求值器（含 010「真实之剑」的 2 颗任意骰置换；尘起支付步的 UI 支持置换）。
  // 不含 034 存放骰（尘起支付步的骰片只列区域骰）——`held:false`，避免"按钮出现却做不完"。
  const hasMed = canPayCosts(g, player, { meditation: 1 }, { held: false });
  // L02 残影（持续）：每个尘起阶段可进行最多 2 次「尘起行动」（默认 1 次）
  const normalLimit = hasActiveSkill(p, 'ying.canying') ? 2 : 1;
  const canNormal = (g.freeDustRise > 0 || g.dustRiseNormalCount < normalLimit) && hasMed;
  // 战术牌 T12「激进」：你自己的**第一个尘起阶段**里，可对**第三列**神器额外充能 1 次（正常支付冥想骰）
  const t12Extra =
    g.firstRound[player] && TACTIC_BY_ID[p.tactic ?? '']?.key === 'jijin' && !p.tacticOnceUsed;
  // 默认候选（仅供 AI/测试；UI 会让玩家自选）：有冥想骰就用它；没有（但可用 010 置换）就用求值器构造的可行填法
  const medId = p.areas.meditation[0]?.id;
  const medSlot: SlotFill[] | undefined = medId
    ? [{ dieIds: [medId] }]
    : hasMed
      ? defaultCostFills(g, player, { meditation: 1 }, { held: false })
      : undefined;
  // 019 尘起赠予的「无需冥想骰的额外尘起行动」（不占每回合 1 次、不耗尘印）
  const canFree = g.freeNoCostRise > 0;
  for (const a of p.artifacts) {
    if (!canTargetForDustRise(a)) continue;
    if (canFree) {
      const sides = a.column === 3 ? [undefined] : a.activeMarkerSide == null ? ['left', 'right'] : [a.activeMarkerSide === 'left' ? 'right' : 'left'];
      for (const side of sides) {
        acts.push({ t: 'dustRise', artifactId: a.id, free: true, ...(side ? { side: side as 'left' | 'right' } : {}) });
      }
    }
    if (a.column === 3) {
      // 第三列充能：正常尘起次数内，或（T12 额外）首个尘起阶段的第 2 次充能
      if ((canNormal || t12Extra) && medSlot) acts.push({ t: 'dustRise', artifactId: a.id, costSlots: medSlot });
      if (p.hasDustSeal) acts.push({ t: 'dustRise', artifactId: a.id, useSeal: true });
    } else if (a.activeMarkerSide == null) {
      if (canNormal && medSlot) {
        acts.push({ t: 'dustRise', artifactId: a.id, side: 'left', costSlots: medSlot });
        acts.push({ t: 'dustRise', artifactId: a.id, side: 'right', costSlots: medSlot });
      }
      if (p.hasDustSeal) {
        acts.push({ t: 'dustRise', artifactId: a.id, side: 'left', useSeal: true });
        acts.push({ t: 'dustRise', artifactId: a.id, side: 'right', useSeal: true });
      }
    } else {
      const other = a.activeMarkerSide === 'left' ? 'right' : 'left';
      if (canNormal && medSlot) acts.push({ t: 'dustRise', artifactId: a.id, side: other, costSlots: medSlot });
      if (p.hasDustSeal) acts.push({ t: 'dustRise', artifactId: a.id, side: other, useSeal: true });
    }
  }
  return acts;
}

/** 「充能」技能的默认参数（供充能后强制结算使用；AI/测试同样走这里）。024 狂舞：把自己第 1 颗骰移到另一个区域。 */
function chargeDefaultAction(p: PlayerState, a: Artifact, s: SkillDef): Action {
  const first = KINDS_ORDER.flatMap((k) => p.areas[k])[0];
  const from = first?.kind ?? 'attack';
  const toKind: DiceKind = from === 'defense' ? 'attack' : 'defense';
  return {
    t: 'skill',
    artifactId: a.id,
    side: s.side,
    params: { owner: 'self', dieId: first?.id, toKind },
  };
}

const KINDS_ORDER: DiceKind[] = ['attack', 'defense', 'meditation'];

/** 029 真言·全知：默认（AI/测试）分配——先把成对的同点骰放防御，再抽顺点三连放攻击，其余冥想 */
export function quanzhiDefaultAssign(p: PlayerState): Record<string, DiceKind> {
  const dice = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation];
  const assign: Record<string, DiceKind> = {};
  const pool = new Map<number, Die[]>();
  for (const d of dice) {
    const arr = pool.get(d.value) ?? [];
    arr.push(d);
    pool.set(d.value, arr);
  }
  for (const [v, arr] of [...pool.entries()]) {
    const pairs = Math.floor(arr.length / 2) * 2;
    for (let i = 0; i < pairs; i++) assign[arr[i].id] = 'defense';
    pool.set(v, arr.slice(pairs));
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (let v = 1; v <= 4; v++) {
      const a = pool.get(v);
      const b = pool.get(v + 1);
      const c = pool.get(v + 2);
      if (a?.length && b?.length && c?.length) {
        assign[a[0].id] = 'attack';
        assign[b[0].id] = 'attack';
        assign[c[0].id] = 'attack';
        pool.set(v, a.slice(1));
        pool.set(v + 1, b.slice(1));
        pool.set(v + 2, c.slice(1));
        changed = true;
      }
    }
  }
  for (const d of dice) if (!assign[d.id]) assign[d.id] = 'meditation';
  return assign;
}

/** 029 真言·全知：给定骰（值）里是否还含可组合的「同点对」（同点数 ≥2）或「3 连顺点」（v、v+1、v+2 都有） */
export function quanzhiRemainderHasGroup(dice: { value: number }[]): boolean {
  const cnt = new Map<number, number>();
  for (const d of dice) cnt.set(d.value, (cnt.get(d.value) ?? 0) + 1);
  for (const [, c] of cnt) if (c >= 2) return true;
  for (let v = 1; v <= 4; v++) {
    if ((cnt.get(v) ?? 0) > 0 && (cnt.get(v + 1) ?? 0) > 0 && (cnt.get(v + 2) ?? 0) > 0) return true;
  }
  return false;
}

/** 029 真言·全知：校验玩家的分配是否满足「防御=同点成对 / 攻击=顺点三连 / 其余冥想（且不得再含可分组）」（越界抛错，不静默修正） */
export function validateQuanzhiAssign(g: GameState, player: PlayerId, assign: Record<string, DiceKind>): void {
  const p = g.players[player];
  const dice = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation];
  for (const d of dice) {
    const k = assign[d.id];
    if (k !== 'attack' && k !== 'defense' && k !== 'meditation') {
      throw new Error(`「全知」非法落区：${d.id}`);
    }
  }
  const defCount = new Map<number, number>();
  const atkCount = new Map<number, number>();
  for (const d of dice) {
    if (assign[d.id] === 'defense') defCount.set(d.value, (defCount.get(d.value) ?? 0) + 1);
    if (assign[d.id] === 'attack') atkCount.set(d.value, (atkCount.get(d.value) ?? 0) + 1);
  }
  for (const [v, c] of defCount) if (c % 2 !== 0) throw new Error(`「全知」防御区的 ${v} 点未成对`);
  let total = [...atkCount.values()].reduce((a, b) => a + b, 0);
  if (total % 3 !== 0) throw new Error('「全知」攻击区的骰数必须为 3 的倍数');
  let guard = 0;
  while (total > 0 && guard++ < 100) {
    let found = false;
    for (let v = 1; v <= 4; v++) {
      if ((atkCount.get(v) ?? 0) > 0 && (atkCount.get(v + 1) ?? 0) > 0 && (atkCount.get(v + 2) ?? 0) > 0) {
        atkCount.set(v, atkCount.get(v)! - 1);
        atkCount.set(v + 1, atkCount.get(v + 1)! - 1);
        atkCount.set(v + 2, atkCount.get(v + 2)! - 1);
        total -= 3;
        found = true;
        break;
      }
    }
    if (!found) break;
  }
  if (total !== 0) throw new Error('「全知」攻击区无法拆成顺点三元组');
  // 强制分组：冥想区不得再含「同点对」或「3 连顺点」（有则必须继续分配，FAQ 29.1.2）
  const meditationDice = dice.filter((d) => assign[d.id] === 'meditation');
  if (quanzhiRemainderHasGroup(meditationDice)) {
    throw new Error('「全知」剩余骰仍可组合（同点对/顺点），必须继续分配');
  }
}

/** 「激活」类技能：仅在该侧被“切入”的当回合生效（尘起装填即强制结算；此处用于校验/UI 显示） */
function activationUsable(g: GameState, a: { armedSide: 'left' | 'right' | null; armedTurn: number }, s: { side: 'left' | 'right' | 'only' }): boolean {
  return a.armedSide === (s.side === 'only' ? 'left' : s.side) && a.armedTurn === g.turnIndex;
}

/** 「激活」类技能的默认参数（供尘起装填后的强制结算使用；AI/测试同样走这里） */
function activationDefaultAction(g: GameState, p: PlayerState, a: Artifact, s: SkillDef): Action {
  const base = { t: 'skill' as const, artifactId: a.id, side: s.side };
  if (s.key === 'xuyu.void') return { ...base, params: { kind: 'attack' } };
  if (s.key === 'chengjie.jinghua') {
    const opp: PlayerId = p.id === 'A' ? 'B' : 'A';
    const pick = [...g.players[opp].areas.attack, ...g.players[opp].areas.defense, ...g.players[opp].areas.meditation].filter((d) => d.value === 1);
    return { ...base, params: { targetDieIds: pick.slice(0, 2).map((d) => d.id) } };
  }
  if (s.key === 'chengjie.shuzui') {
    const pick = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation].filter((d) => d.value === 1);
    return { ...base, params: { targetDieIds: pick.slice(0, 2).map((d) => d.id) } };
  }
  if (s.key === 'zhenyan.ganshe') {
    // 默认（AI/测试）：把前 3 颗能力骰统一改为 6 点
    const ids = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation].slice(0, 3).map((d) => d.id);
    return { ...base, params: { value: 6, dieIds: ids } };
  }
  if (s.key === 'ezhao.qingsuan') {
    // 默认（AI/测试）：弃置对方 min(计数, 对方骰数) 颗
    const oppId: PlayerId = p.id === 'A' ? 'B' : 'A';
    const opp = g.players[oppId];
    const oppDice = [...opp.areas.attack, ...opp.areas.defense, ...opp.areas.meditation];
    const d = Math.min(a.count, oppDice.length);
    return { ...base, params: { dieIds: oppDice.slice(0, d).map((x) => x.id) } };
  }
  if (s.key === 'jingang.pozhang' || s.key === 'jingang.puti') {
    // 默认（AI/测试）：取 1/2/3 点
    return { ...base, params: { pips: [1, 2, 3] } };
  }
  if (s.key === 'jingang.alt.pozhang' || s.key === 'jingang.alt.puti') {
    // 默认（AI/测试）：2 个任意点数，取两个相同点（合法输入）
    return { ...base, params: { pips: [1, 1] } };
  }
  return { ...base, params: {} };
}

/** 尘起装填到某侧后，若该侧有「激活」技能：立即强制结算（无选择项则直接执行处理器） */
function resolveActivationOnArm(g: GameState, player: PlayerId, artifactId: string, side: 'left' | 'right'): void {
  const p = g.players[player];
  const a = p.artifacts.find((x) => x.id === artifactId);
  if (!a) return;
  const armed: 'left' | 'right' = side;
  const s = a.skills.find((x) => x.kind === 'activation' && (x.side === armed || (a.column === 3 && x.side === 'only')));
  if (!s) return;
  const handler = SKILL_HANDLERS[s.key];
  if (!handler) return;
  logLine(g, `「${a.name}」的「激活」技能立即结算`);
  if (activationNeedsChoice(s.key)) {
    g.pending = { kind: 'activationResolve', player, artifactId, side: s.side };
    return;
  }
  withRng(g, (rng) =>
    handler.run({
      g,
      player,
      artifact: a,
      rng,
      params: {},
      endMainPhase: () => endMainPhase(g),
      reportConsumed: () => {},
    }),
  );
  // 动效旁路："激活"立即发动其技能 → 第二条气泡（技能名）；先由 rise 弹「激活」。
  fxPush({ kind: 'skillFired', player, artifactId, side: s.side, skillKey: s.key, auto: false });
}

/** 该「激活」技能是否需要玩家选择（需要则装填时弹出强制选择器） */
function activationNeedsChoice(key: string): boolean {
  return (
    key === 'xuyu.void' ||
    key === 'chengjie.jinghua' ||
    key === 'chengjie.shuzui' ||
    key === 'zhenyan.ganshe' ||
    key === 'ezhao.qingsuan' ||
    key === 'jingang.pozhang' ||
    key === 'jingang.puti' ||
    key === 'jingang.alt.pozhang' ||
    key === 'jingang.alt.puti'
  );
}

/** 该技能当前是否属于“可发动”类型（启动 / 必杀；「激活」由尘起装填时强制结算，不在此列） */
function isUsableKind(kind: string): boolean {
  return kind === 'activate' || kind === 'ultimate';
}

/** 走「slots」向导的技能（001/003/007/035）：激活 010 后向导改走 slots 步，而 slots 步暂不支持存放骰
 *  （UI 延期项）→ 这些技能的存放骰在门槛里先不计入，避免"按钮出现但做不完"。其余技能一律计入。 */
const heldForSlotsSkill = (p: PlayerState): boolean => !hasActiveSkill(p, 'shenhong.sword');

/** 某技能本回合的使用次数上限（默认 1；L02 残影：影袭 → 2） */
const skillPerTurnLimit = (p: PlayerState, key: string): number =>
  key === 'yingle.yingxi' && hasActiveSkill(p, 'ying.canying') ? 2 : 1;

function activateSkillActions(g: GameState, p: PlayerState): Action[] {
  const acts: Action[] = [];
  // L08 传奇面板·没有怜悯（持续·尘落前置 4）：024「狂舞」的**必杀**无需激活/充能即可启动（每回合 1 次、不计整局一次）
  const lianminOn = hasActiveSkill(p, 'xiva.meiyoulianmin') && g.dustfall >= 4;
  for (const a of p.artifacts) {
    for (const s of a.skills) {
      if (!isUsableKind(s.kind)) continue;
      const lianminUlt = lianminOn && s.key === 'kuangwu.ultimate';
      if (!lianminUlt && !skillActive(a, s)) continue;
      if (s.kind === 'activation' && !activationUsable(g, a, s)) continue;
      if (s.kind === 'ultimate' && !lianminUlt && g.ultimatesUsed.includes(skillUseKey(p.id, s.key))) continue;
      if (
        g.skillsUsedThisTurn.filter((k) => k === skillUseKey(p.id, s.key)).length >=
        skillPerTurnLimit(p, s.key)
      )
        continue;
      if (s.key === 'buxiang.cuilian') {
        if (a.count >= 3) continue;
        const held = heldForSlotsSkill(p);
        if (!canPayCosts(g, p.id, { attack: 1 }, { held })) continue;
        const atkDice = abilityDicePool(g, p.id).filter((x) => (held || x.source === 'area') && x.kind === 'attack');
        for (const d of atkDice) {
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { costSlots: [{ dieIds: [d.id] }] } });
        }
        // 同类型骰不足时用「真实之剑」置换凑（2 颗任意骰顶 1 颗）
        if (atkDice.length === 0) {
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { costSlots: defaultCostFills(g, p.id, { attack: 1 }, { held }) } });
        }
      } else if (s.key === 'youlong.tengwan') {
        if (canPayCosts(g, p.id, { meditation: 3 }, { held: true })) {
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { costSlots: defaultCostFills(g, p.id, { meditation: 3 }, { held: true }) } });
        }
      } else if (s.key === 'yingle.qianxing') {
        if (canPayCosts(g, p.id, { attack: 2 }, { held: true })) {
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { costSlots: defaultCostFills(g, p.id, { attack: 2 }, { held: true }) } });
        }
      } else if (s.key === 'yuqie.breakthrough') {
        const held = heldForSlotsSkill(p);
        const n = maxAffordableSlots(g, p.id, 'meditation', 3, { held });
        if (n >= 1) {
          const costSlots = defaultCostFills(g, p.id, { meditation: n }, { held });
          const opp: PlayerId = g.activePlayer === 'A' ? 'B' : 'A';
          const oppDef = g.players[opp].areas.defense;
          const required = Math.min(n, oppDef.length);
          const oppDefIds = oppDef.slice(0, required).map((d) => d.id);
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { costSlots, opponentDefenseDieIds: oppDefIds } });
        }
      } else if (s.key === 'c01.breakthrough') {
        // C01 特典·突破：消耗任意数量冥想骰（=可支付上限）→ 弃对方等量防御骰（发起者选）
        const n = maxAffordableSlots(g, p.id, 'meditation', 99, { held: true });
        if (n >= 1) {
          const costSlots = defaultCostFills(g, p.id, { meditation: n }, { held: true });
          const opp: PlayerId = g.activePlayer === 'A' ? 'B' : 'A';
          const oppDef = g.players[opp].areas.defense;
          const required = Math.min(n, oppDef.length);
          const oppDefIds = oppDef.slice(0, required).map((d) => d.id);
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { costSlots, opponentDefenseDieIds: oppDefIds } });
        }
      } else if (s.key === 'yingle.yingxi') {
        const anyDie = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation].find((d) => d.value >= 2);
        if (anyDie) acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { dieId: anyDie.id, x: 1 } });
      } else if (s.key === 'mingjing.ultimate') {
        acts.push({ t: 'skill', artifactId: a.id, side: s.side });
        // L01 断苇一斩（触发）：若"我上一个回合整回合未造成任何伤害"，可改为"弃置对方**全部**能力骰"
        if (p.legend && hasActiveSkill(p, 'kong.duanweiyizhan') && p.noDamageLastTurn) {
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { opponentDiscardAll: true } });
        }
      } else if (s.key === 'canxiang.juejing.ultimate') {
        acts.push({ t: 'skill', artifactId: a.id, side: s.side });
      } else if (s.key === 'chengjie.jinghua') {
        const opp: PlayerId = g.activePlayer === 'A' ? 'B' : 'A';
        const pick = g.players[opp].areas.attack
          .concat(g.players[opp].areas.defense, g.players[opp].areas.meditation)
          .filter((d) => d.value === 1);
        acts.push({
          t: 'skill',
          artifactId: a.id,
          side: s.side,
          params: { targetDieIds: pick.slice(0, 2).map((d) => d.id) },
        });
      } else if (s.key === 'chengjie.shuzui') {
        const pick = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation].filter((d) => d.value === 1);
        acts.push({
          t: 'skill',
          artifactId: a.id,
          side: s.side,
          params: { targetDieIds: pick.slice(0, 2).map((d) => d.id) },
        });
      } else if (s.key === 'wansha.ultimate') {
        if (canPayCosts(g, p.id, { attack: 1 }, { held: true })) {
          const fills = defaultCostFills(g, p.id, { attack: 1 }, { held: true });
          const eff = fills[0].dieIds.length === 2 ? 5 : (findDieOf(g, p.id, fills[0].dieIds[0])?.die.value ?? 5);
          const opp: PlayerId = g.activePlayer === 'A' ? 'B' : 'A';
          const oppDef = g.players[opp].areas.defense.slice(0, eff).map((d) => d.id);
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { costSlots: fills, opponentDefenseDieIds: oppDef } });
        }
      } else if (s.key === 'wansha.alt.ultimate') {
        // A07 异相·历王之血之印：对方防御骰数 ≥ 你攻击骰数才能启动；弃置差额（发起者选）
        const opp: PlayerId = p.id === 'A' ? 'B' : 'A';
        const oppDef = g.players[opp].areas.defense;
        const required = oppDef.length - p.areas.attack.length;
        if (required >= 0) {
          acts.push({
            t: 'skill',
            artifactId: a.id,
            side: s.side,
            params: { opponentDefenseDieIds: oppDef.slice(0, required).map((d) => d.id) },
          });
        }
      } else if (s.key === 'zhuzai.sweep') {
        const held = heldForSlotsSkill(p);
        if (canPayCosts(g, p.id, { attack: 1, defense: 1, meditation: 1 }, { held })) {
          const costSlots = defaultCostFills(g, p.id, { attack: 1, defense: 1, meditation: 1 }, { held });
          const opp: PlayerId = g.activePlayer === 'A' ? 'B' : 'A';
          const o = g.players[opp];
          const discard: Record<string, string> = {};
          if (o.areas.attack[0]) discard.attack = o.areas.attack[0].id;
          if (o.areas.defense[0]) discard.defense = o.areas.defense[0].id;
          if (o.areas.meditation[0]) discard.meditation = o.areas.meditation[0].id;
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { costSlots, discard } });
        }
      } else if (s.key === 'zhuzai.smash') {
        const held = heldForSlotsSkill(p);
        const kinds = ['attack', 'defense', 'meditation'] as const;
        const kind = kinds.find((k) => canPayCosts(g, p.id, { [k]: 4 }, { held }));
        if (kind) {
          const opp: PlayerId = g.activePlayer === 'A' ? 'B' : 'A';
          acts.push({
            t: 'skill',
            artifactId: a.id,
            side: s.side,
            params: {
              kind,
              costSlots: defaultCostFills(g, p.id, { [kind]: 4 }, { held }),
              opponentDiscardIds: g.players[opp].areas[kind].slice(0, 4).map((d) => d.id),
            },
          });
        }
      } else if (s.key === 'tiebi.fist') {
        if (canPayCosts(g, p.id, { meditation: 2 }, { held: true })) {
          acts.push({
            t: 'skill',
            artifactId: a.id,
            side: s.side,
            params: {
              costSlots: defaultCostFills(g, p.id, { meditation: 2 }, { held: true }),
              defenseDieIds: p.areas.defense.slice(0, 2).map((d) => d.id),
            },
          });
        }
      } else if (s.key === 'guwang.ultimate') {
        acts.push({ t: 'skill', artifactId: a.id, side: s.side });
      } else if (s.key === 'dunwu.barrier.activate') {
        // 011 灵能屏障（激活）：消耗 1–3 防御骰（含置换；含 034/A03 存放骰）
        const n = maxAffordableSlots(g, p.id, 'defense', 3, { held: true });
        if (n >= 1) {
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { costSlots: defaultCostFills(g, p.id, { defense: n }, { held: true }) } });
        }
      } else if (s.key === 'dunwu.pulse.activate') {
        // 011 灵能脉冲（激活）：消耗 1–3 攻击骰（含置换；含 034/A03 存放骰）
        const n = maxAffordableSlots(g, p.id, 'attack', 3, { held: true });
        if (n >= 1) {
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { costSlots: defaultCostFills(g, p.id, { attack: n }, { held: true }) } });
        }
      } else if (s.key === 'monv.ultimate') {
        if (p.areas.meditation.length >= 1) {
          acts.push({
            t: 'skill',
            artifactId: a.id,
            side: s.side,
            params: { to: 'attack', meditationDieIds: p.areas.meditation.slice(0, 3).map((d) => d.id) },
          });
        }
      } else if (s.key === 'xuyu.sacrifice') {
        // 016 献祭（启动）：受到 4 真伤 → 二选一（默认 ①获得 3 随机骰）
        acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { choice: 'dice' } });
      } else if (s.key === 'youming.mingjie') {
        // 017 冥界行走（启动）：消耗最多 3 冥想骰 → 获得同等数量随机攻击骰（含置换；含 034/A03 存放骰）
        const n = maxAffordableSlots(g, p.id, 'meditation', 3, { held: true });
        if (n >= 1) {
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { costSlots: defaultCostFills(g, p.id, { meditation: n }, { held: true }) } });
        }
      } else if (s.key === 'zhihai.bloom.ultimate') {
        // 018 漆黑绽放（必杀）：计数 ≥1 时可主动发动（FAQ 18.1.3）；计数=5 由引擎强制发动
        if (a.count >= 1) acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: {} });
      } else if (s.key === 'chenai.fang') {
        // 019 蛮王之牙（启动）：默认消耗 1 个任意能力骰 + 选择 ② 获得 1 个 3 点攻击骰
        const anyDie = abilityDicePool(g, p.id)[0];
        if (anyDie) {
          acts.push({
            t: 'skill',
            artifactId: a.id,
            side: s.side,
            params: { costSlots: [{ dieIds: [anyDie.id] }], picks: ['gain'] },
          });
        }
      } else if (s.key === 'siji.tiandan') {
        // 022 死契·填弹（启动）：默认消耗 1 个任意能力骰（1 颗无「顺点」要求）
        const anyDie = abilityDicePool(g, p.id)[0];
        if (anyDie) {
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { dieIds: [anyDie.id] } });
        }
      } else if (s.key === 'shexie.weiju') {
        // 023 蛇蝎·畏惧（启动）：我方与对方都必须有至少 1 颗能力骰，否则不能发动（我方可用 034/A03 存放骰）
        const opp: PlayerId = p.id === 'A' ? 'B' : 'A';
        const anyDie = abilityDicePool(g, p.id)[0];
        const oppDice = [...g.players[opp].areas.attack, ...g.players[opp].areas.defense, ...g.players[opp].areas.meditation];
        if (anyDie && oppDice.length >= 1) {
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { dieId: anyDie.id } });
        }
      } else if (s.key === 'shexie.gongzhen') {
        // 023 蛇蝎·共振（启动）：默认重掷我方第 1 颗骰（存放骰不在区域、不可重掷 → 只列区域真骰）
        const anyDie = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation][0];
        if (anyDie) {
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { dieId: anyDie.id } });
        }
      } else if (s.key === 'kuangwu.ultimate') {
        // 024 狂舞·凶弹业舞（必杀）：默认每个区域取最多 3 颗、顺时针
        const opp: PlayerId = p.id === 'A' ? 'B' : 'A';
        const groups = [p, g.players[opp]].flatMap((who) =>
          (['defense', 'attack', 'meditation'] as const).map((k) => who.areas[k].slice(0, 3).map((d) => d.id)),
        );
        acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { groups, direction: 'cw' } });
      } else if (s.key === 'hanguang.ultimate') {
        // 027 寒光·凛冽之音（必杀）：取 1–6 点各 1 颗置于本神器上（无需参数）
        acts.push({ t: 'skill', artifactId: a.id, side: s.side });
      } else if (s.key === 'jiushu.huanyu.ultimate') {
        // 030 救赎·寰宇飞升（必杀）：消耗 4 个冥想骰（含置换；含 034/A03 存放骰）
        if (canPayCosts(g, p.id, { meditation: 4 }, { held: true })) {
          acts.push({
            t: 'skill',
            artifactId: a.id,
            side: s.side,
            params: { costSlots: defaultCostFills(g, p.id, { meditation: 4 }, { held: true }) },
          });
        }
      } else if (s.key === 'mengyan.eyi') {
        // 032 梦魇·恶意（启动）：消耗 1 个攻击骰 → 获得 2 个随机点数冥想骰（含置换；含 034/A03 存放骰）
        if (canPayCosts(g, p.id, { attack: 1 }, { held: true })) {
          acts.push({
            t: 'skill',
            artifactId: a.id,
            side: s.side,
            params: { costSlots: defaultCostFills(g, p.id, { attack: 1 }, { held: true }) },
          });
        }
      } else if (s.key === 'qianjie.chaodu') {
        // 035 千劫·超度（启动）：消耗 2 颗点数相同的冥想骰 → 5 真伤 → 重掷任意玩家一区
        // 存放骰：向导为 slots 步（激活 010 时）→ held=false；否则 dice 步（含存放骰）→ held=true
        const held = heldForSlotsSkill(p);
        const med = abilityDicePool(g, p.id).filter((x) => (held || x.source === 'area') && x.kind === 'meditation');
        const byVal = new Map<number, string[]>();
        for (const d of med) {
          const arr = byVal.get(d.value) ?? [];
          arr.push(d.id);
          byVal.set(d.value, arr);
        }
        let fills: SlotFill[] | null = null;
        const pairIds = [...byVal.values()].find((ids) => ids.length >= 2);
        if (pairIds) {
          // ① 真骰/存放骰里已有同点对
          fills = [{ dieIds: [pairIds[0]] }, { dieIds: [pairIds[1]] }];
        } else if (hasActiveSkill(p, 'shenhong.sword')) {
          // ② 用「真实之剑」置换凑「两颗 5 点」：真/存放 5 点 + 1 格置换（=5），或两颗都置换（=5,5）
          const pool = abilityDicePool(g, p.id).filter((x) => held || x.source === 'area');
          const five = med.find((d) => d.value === 5);
          if (five) {
            const rest = pool.filter((x) => x.id !== five.id);
            if (rest.length >= 2) fills = [{ dieIds: [five.id] }, { dieIds: [rest[0].id, rest[1].id] }];
          }
          if (!fills && pool.length >= 4) {
            fills = [{ dieIds: [pool[0].id, pool[1].id] }, { dieIds: [pool[2].id, pool[3].id] }];
          }
        }
        if (fills) {
          acts.push({
            t: 'skill',
            artifactId: a.id,
            side: s.side,
            params: { costSlots: fills, targetOwner: 'opponent', targetKind: 'attack' },
          });
        }
      } else if (s.key === 'wuxiang.wanxiang.ultimate') {
        // 036 无相·万象俱灭（必杀）：仅当双方 6 区中 1–6 点各至少 1 个时提供（默认各取首个）
        const seen = new Set<number>();
        const keepIds: string[] = [];
        for (const who of ['A', 'B'] as PlayerId[]) {
          for (const k of KINDS_ORDER) {
            for (const d of g.players[who].areas[k]) {
              if (!seen.has(d.value)) {
                seen.add(d.value);
                keepIds.push(d.id);
              }
            }
          }
        }
        if (seen.size === 6) {
          acts.push({ t: 'skill', artifactId: a.id, side: s.side, params: { keepIds } });
        }
      }
    }
  }
  // 传奇英雄面板技能（开局即可用、无需激活）：需要玩家点击发动的「必杀 / 启动」类
  const lg = p.legend;
  if (lg) {
    for (const s of lg.skills) {
      if (s.kind !== 'ultimate' && s.kind !== 'activate') continue;
      if (g.ultimatesUsed.includes(skillUseKey(p.id, s.key))) continue;
      if (
        g.skillsUsedThisTurn.filter((k) => k === skillUseKey(p.id, s.key)).length >=
        skillPerTurnLimit(p, s.key)
      )
        continue;
      if (!legendSkillReady(g, p.id, s.key)) continue; // 尘落前置 + 个别额外前提（唯一来源）
      // 面板可能同时含「启动 / 必杀」→ 动作带上 key，供引擎与界面精确区分
      acts.push({ t: 'skill', artifactId: lg.id, side: 'only', params: { legendKey: s.key } });
    }
  }
  return acts;
}

/**
 * 传奇面板技能当前**是否可发动**（引擎与界面**同一来源**）：尘落前置 + 个别技能的额外前提。
 * `getLegalActions` 与 `render.ts` 的技能行灰绿判定都必须走这里（否则会出现"界面绿、引擎不给动作"的不一致）。
 */
export function legendSkillReady(g: GameState, player: PlayerId, key: string): boolean {
  if (g.dustfall < (LEGEND_DUSTFALL_REQ[key] ?? 0)) return false; // 尘落前置
  // L07「不屈咆哮」：还要求「决意」**当前计数 ≥ 1**（计数 0 时不给按钮——否则弃 0 颗却把计数重设为 1）
  if (key === 'nisa.buqupaoxiao') {
    const p = g.players[player];
    const jy = p.artifacts.find((a) => a.skills.some((x) => x.key === 'jueyi.wildfire'));
    if (!jy || jy.count < 1) return false;
  }
  // L09「遍野残杀」：还要求**你的所有神器均处于激活状态**（每件至少一侧有激活标记；第三列＝充能满）
  if (key === 'lifeng.bianyecansha') {
    const p = g.players[player];
    if (!p.artifacts.every((a) => a.activeMarkerSide != null)) return false;
  }
  return true;
}

/**
 * 「必杀就绪」唯一来源：该玩家当前是否有**可发动的必杀式**（只看"就绪前提"，**不看是否轮到他行动、
 * 也不看是否付得起代价**）。供战术牌 T04「末路」的"生效中"（绿）判定。
 * - 第三列神器必杀：充能满（已激活，`skillActive` 成立）且未用尽；
 * - **没有怜悯**（L08）：持 `xiva.meiyoulianmin` 且尘落 ≥4 时，024「狂舞」的必杀**无需充能**即算就绪；
 * - 传奇面板必杀：`legendSkillReady`（尘落前置等）且未用尽；
 * 均需本回合次数上限未用完。
 */
export function hasReadyUltimate(g: GameState, player: PlayerId): boolean {
  const p = g.players[player];
  const lianmin = hasActiveSkill(p, 'xiva.meiyoulianmin') && g.dustfall >= 4;
  const perTurnLeft = (key: string): boolean =>
    g.skillsUsedThisTurn.filter((k) => k === skillUseKey(player, key)).length < skillPerTurnLimit(p, key);
  for (const a of p.artifacts) {
    for (const s of a.skills) {
      if (s.kind !== 'ultimate') continue;
      const lianminUlt = lianmin && s.key === 'kuangwu.ultimate';
      if (!lianminUlt) {
        if (!skillActive(a, s)) continue;
        if (g.ultimatesUsed.includes(skillUseKey(player, s.key))) continue;
      }
      if (!perTurnLeft(s.key)) continue;
      return true;
    }
  }
  const lg = p.legend;
  if (lg) {
    for (const s of lg.skills) {
      if (s.kind !== 'ultimate') continue;
      if (g.ultimatesUsed.includes(skillUseKey(player, s.key))) continue;
      if (!legendSkillReady(g, player, s.key)) continue;
      if (!perTurnLeft(s.key)) continue;
      return true;
    }
  }
  return false;
}

export function getLegalActions(g: GameState): Action[] {
  if (g.phase === 'gameOver') return [];
  // 战术牌·战前抽 2 留 1：只枚举**当前选者**手里的 2 张（有待决策时交给下面的 pending 分支）
  if (g.phase === 'tactics' && !g.pending) {
    if (!g.tacticQueue[0]) return [];
    return g.tacticHand.map((id) => ({ t: 'tacticPick' as const, id }));
  }

  if (g.pending) {
    if (g.pending.kind === 'caiyuliu') {
      return [
        { t: 'caiyuliu', to: null },
        { t: 'caiyuliu', to: 'defense' },
        { t: 'caiyuliu', to: 'meditation' },
      ];
    }
    if (g.pending.kind === 'c01Caiyuliu') {
      return [
        { t: 'c01Caiyuliu', accept: true },
        { t: 'c01Caiyuliu', accept: false },
      ];
    }
    if (g.pending.kind === 'guwangCharge') {
      const opponent: PlayerId = g.pending.player === 'A' ? 'B' : 'A';
      const acts: Action[] = [{ t: 'guwangCharge' }];
      for (const d of g.players[opponent].areas.attack) acts.push({ t: 'guwangCharge', dieId: d.id });
      return acts;
    }
    if (g.pending.kind === 'guwangCancel') {
      const p = g.players[g.pending.player];
      const acts: Action[] = [{ t: 'guwangCancel', cancel: false }];
      for (const d of p.areas.defense) acts.push({ t: 'guwangCancel', cancel: true, defenseDieId: d.id });
      for (const h of heldAbilityDice(g, g.pending.player)) {
        if (h.kind === 'defense') acts.push({ t: 'guwangCancel', cancel: true, defenseDieId: h.id });
      }
      return acts;
    }
    if (g.pending.kind === 'shenhongKill') {
      return [
        { t: 'shenhongKill', accept: true },
        { t: 'shenhongKill', accept: false },
      ];
    }
    if (g.pending.kind === 'aidao') {
      const opp: PlayerId = g.pending.player === 'A' ? 'B' : 'A';
      const defense = g.players[opp].areas.defense;
      // 有防御骰时必须弃置 1 颗（由持有者选择弃哪颗）→ 不给"不弃骰"的发动选项；无则仅造成 2 点真实伤害。
      // 只能从对方**区域内**的防御骰中选（034 破障的存放骰不属区域 → 不可选）。
      const fire: Action[] = defense.length
        ? defense.map((d) => ({ t: 'aidao' as const, accept: true, defenseDieId: d.id }))
        : [{ t: 'aidao' as const, accept: true }];
      return [{ t: 'aidao', accept: false }, ...fire];
    }
    if (g.pending.kind === 'dunwuHalve') {
      const p = g.players[g.pending.player];
      return [
        { t: 'dunwuHalve', accept: false },
        ...p.areas.meditation.map((d) => ({ t: 'dunwuHalve' as const, accept: true, meditationDieId: d.id })),
        ...heldAbilityDice(g, g.pending.player)
          .filter((h) => h.kind === 'meditation')
          .map((h) => ({ t: 'dunwuHalve' as const, accept: true, meditationDieId: h.id })),
      ];
    }
    if (g.pending.kind === 'dunwuPulse') {
      return [
        { t: 'dunwuPulse', accept: true },
        { t: 'dunwuPulse', accept: false },
      ];
    }
    if (g.pending.kind === 'leibaoReroll') {
      return [
        { t: 'leibaoReroll', accept: true },
        { t: 'leibaoReroll', accept: false },
      ];
    }
    if (g.pending.kind === 'dianxing') {
      const p = g.players[g.pending.player];
      const acts: Action[] = [{ t: 'dianxing', accept: false }];
      // 默认动作（供 AI / 测试）：取前 2 颗冥想骰；真人由 UI 打开选骰面板显式选择
      const first2 = p.areas.meditation.slice(0, 2).map((d) => d.id);
      if (first2.length === 2) acts.push({ t: 'dianxing', dieIds: first2 });
      return acts;
    }
    if (g.pending.kind === 'leibao') {
      const p = g.players[g.pending.player];
      const pick = p.areas.meditation.slice(0, 2).map((d) => d.id);
      return [
        { t: 'leibao', accept: false },
        { t: 'leibao', dieIds: pick },
      ];
    }
    if (g.pending.kind === 'shizushouhun') {
      const p = g.players[g.pending.player];
      const acts: Action[] = [{ t: 'shizushouhun', accept: false }];
      // 默认填法（仅供 AI / 测试）；UI 会走「@shizushouhun」选择器让玩家自选冥想骰
      const medId = p.areas.meditation[0]?.id;
      const fills: SlotFill[] | undefined = medId
        ? [{ dieIds: [medId] }]
        : defaultCostFills(g, p.id, { meditation: 1 }, { held: true });
      if (fills) acts.push({ t: 'shizushouhun', accept: true, costSlots: fills });
      return acts;
    }
    if (g.pending.kind === 'shangjin') {
      const p = g.players[g.pending.player];
      const acts: Action[] = [{ t: 'shangjin', decline: true }];
      // 可选项 = 你**已激活**的「启动式」技能（UI 会为每个选项打开该技能自己的选择器，
      // 由 `case 'skill'` 在 `shangjin` 待决策存在时按"不计入每回合上限"执行）
      for (const a of p.artifacts) {
        for (const s of a.skills) {
          if (s.kind !== 'activate') continue;
          if (!skillActive(a, s)) continue;
          acts.push({ t: 'shangjin', artifactId: a.id, side: s.side, skillKey: s.key });
        }
      }
      return acts;
    }
    if (g.pending.kind === 'dizuidaijianshu') {
      // 不发动 / 发动（具体 2 颗由选择器补全；`{t:'dizuidaijianshu'}` 形式供 UI 拦截后打开面板）
      return [{ t: 'dizuidaijianshu', accept: false }, { t: 'dizuidaijianshu' }];
    }
    if (g.pending.kind === 'nudengzuiren') {
      return [
        { t: 'nudengzuiren', accept: false },
        { t: 'nudengzuiren', accept: true },
      ];
    }
    if (g.pending.kind === 'duanexing') {
      // 不发动 / 弃置对方 1 个**攻击骰**（选哪颗由玩家决定；仅取对方攻击骰区，神上存放骰不算）
      const opp = g.players[g.pending.player === 'A' ? 'B' : 'A'];
      return [
        { t: 'duanexing', accept: false },
        ...opp.areas.attack.map((d) => ({ t: 'duanexing' as const, accept: true, dieId: d.id })),
      ];
    }
    if (g.pending.kind === 'tacticDice') {
      // 默认动作（供 AI/测试）：按分布每类最多取 4 颗、凑满意志数；真人由 UI 弹窗自选
      const p = g.players[g.pending.player];
      const dist = emptyDistribution(p) ?? { attack: [1, 2], defense: [3, 4], meditation: [5, 6] };
      const will = effectiveWill(p);
      const values: number[] = [];
      for (const kind of ['attack', 'defense', 'meditation'] as const) {
        for (let i = 0; i < 4 && values.length < will && dist[kind].length > 0; i++) {
          values.push(dist[kind][0]);
        }
      }
      return [{ t: 'tacticDice', values }];
    }
    if (g.pending.kind === 'tacticFirst') {
      return [
        { t: 'tacticFirst', who: 'A' },
        { t: 'tacticFirst', who: 'B' },
      ];
    }
    if (g.pending.kind === 'tacticGuess') {
      return [
        { t: 'tacticGuess', who: 'A' },
        { t: 'tacticGuess', who: 'B' },
      ];
    }
    if (g.pending.kind === 'sijiChuxing') {
      return [
        { t: 'chuxingPick', pick: 'none' },
        { t: 'chuxingPick', pick: 'unblockable' },
        { t: 'chuxingPick', pick: 'bonus5' },
      ];
    }
    if (g.pending.kind === 'weijuPay') {
      const p = g.players[g.pending.player];
      const acts: Action[] = [];
      for (const k of ['attack', 'defense', 'meditation'] as const) {
        for (const d of p.areas[k]) acts.push({ t: 'weijuPay', dieId: d.id });
      }
      for (const h of heldAbilityDice(g, g.pending.player)) acts.push({ t: 'weijuPay', dieId: h.id });
      return acts;
    }
    // 挑战模式·代决：把该待决策的全部候选直接枚举（挑战者代为决定）
    if (g.pending.kind === 'challengePick') {
      return g.pending.options.map((o) => ({ t: 'challengePick' as const, id: o.id }));
    }
    if (g.pending.kind === 'gongzhenPick') {
      const pd = g.pending;
      const me = g.players[pd.player];
      const opp = g.players[pd.player === 'A' ? 'B' : 'A'];
      const acts: Action[] = [{ t: 'gongzhenResolve', pick: 'gain' }];
      const myIds = me.areas[pd.areaKind].slice(0, 2).map((d) => d.id); // 默认候选（AI/测试用）
      const oppIds = opp.areas[pd.areaKind].slice(0, 2).map((d) => d.id);
      if (myIds.length + oppIds.length > 0) acts.push({ t: 'gongzhenResolve', pick: 'discard', myIds, oppIds });
      return acts;
    }
    if (g.pending.kind === 'chargeResolve') {
      const pd = g.pending;
      const p = g.players[pd.player];
      const a = p.artifacts.find((x) => x.id === pd.artifactId);
      const s = a?.skills.find((x) => x.kind === 'charge');
      if (!a || !s) return [{ t: 'advance' }];
      return [chargeDefaultAction(p, a, s)];
    }
    if (g.pending.kind === 'weiyaPick') {
      const pd = g.pending;
      const me = g.players[pd.player];
      const opp = g.players[pd.player === 'A' ? 'B' : 'A'];
      const acts: Action[] = [{ t: 'weiyaPick', owner: 'self' }]; // 省略 dieId = 不发动「威压」
      for (const k of KINDS_ORDER) {
        for (const d of me.areas[k]) acts.push({ t: 'weiyaPick', owner: 'self', dieId: d.id });
        for (const d of opp.areas[k]) acts.push({ t: 'weiyaPick', owner: 'opp', dieId: d.id });
      }
      return acts;
    }
    if (g.pending.kind === 'xianzhenPick') {
      const pd = g.pending;
      const ownerP = g.players[pd.owner];
      const acts: Action[] = [];
      for (const k of KINDS_ORDER) {
        for (const d of ownerP.areas[k]) acts.push({ t: 'xianzhenResolve', dieId: d.id });
      }
      return acts;
    }
    if (g.pending.kind === 'hengguan') {
      const pd = g.pending;
      const opp = g.players[pd.player === 'A' ? 'B' : 'A'];
      const acts: Action[] = [{ t: 'hengguan' }]; // 省略 dieId = 不发动
      for (const k of KINDS_ORDER) {
        for (const d of opp.areas[k]) {
          if (d.value < pd.value) acts.push({ t: 'hengguan', dieId: d.id });
        }
      }
      return acts;
    }
    if (g.pending.kind === 'hanguangPick') {
      const pd = g.pending;
      const card = artifactWithSkill(g.players[pd.player], 'hanguang.ultimate');
      const held = card?.heldDice ?? [];
      const opp = g.players[pd.player === 'A' ? 'B' : 'A'];
      const acts: Action[] = [];
      for (const h of held) {
        acts.push({ t: 'hanguangPick', pick: 'move', dieId: h.id });
        for (const k of KINDS_ORDER) {
          for (const d of opp.areas[k]) {
            if (d.value === h.value) {
              acts.push({ t: 'hanguangPick', pick: 'discard', dieId: h.id, targetDieId: d.id });
            }
          }
        }
      }
      return acts;
    }
    if (g.pending.kind === 'chenaiFreeRise') {
      return [
        { t: 'chenaiFreeRise', accept: true },
        { t: 'chenaiFreeRise', accept: false },
      ];
    }
    if (g.pending.kind === 'anyexiongshen') {
      return [
        { t: 'anyexiongshen', accept: true },
        { t: 'anyexiongshen', accept: false },
      ];
    }
    if (g.pending.kind === 'bacheng') {
      return [
        { t: 'bacheng', accept: true },
        { t: 'bacheng', accept: false },
      ];
    }
    if (g.pending.kind === 'yuanwu') {
      // L06 圆舞：强制——选 1 颗能力骰 + 目标区域（默认供 AI/测试；真人走两步选择器）
      const pd = g.pending;
      const pp = g.players[pd.player];
      const acts: Action[] = [];
      for (const k of ['attack', 'defense', 'meditation'] as DiceKind[]) {
        for (const d of pp.areas[k]) {
          const dest = (['attack', 'defense', 'meditation'] as DiceKind[]).find((x) => x !== k);
          if (dest) acts.push({ t: 'yuanwu', dieId: d.id, to: dest });
        }
      }
      return acts;
    }
    if (g.pending.kind === 'fuchouRise') {
      return fuchouRiseActions(g, g.pending.player);
    }
    if (g.pending.kind === 'wufaraoshu') {
      const pd = g.pending;
      const opp: PlayerId = pd.player === 'A' ? 'B' : 'A';
      const acts: Action[] = [{ t: 'wufaraoshu', choice: 'decline' }];
      for (const d of g.players[opp].areas.defense) {
        if (d.value === pd.value) acts.push({ t: 'wufaraoshu', choice: 'discard', dieId: d.id });
      }
      return acts;
    }
    if (g.pending.kind === 'kongYuluo') {
      // L01 雨落狂流：①弃置对方 1 个能力骰（逐颗列举）/②获得 1 随机点数能力骰并移入任意区域/不发动
      const pd = g.pending;
      const opp: PlayerId = pd.player === 'A' ? 'B' : 'A';
      const o = g.players[opp];
      const acts: Action[] = [
        { t: 'kongYuluo', choice: 'decline' },
        { t: 'kongYuluo', choice: 'gain', kind: 'attack' },
        { t: 'kongYuluo', choice: 'gain', kind: 'defense' },
        { t: 'kongYuluo', choice: 'gain', kind: 'meditation' },
      ];
      for (const k of ['attack', 'defense', 'meditation'] as DiceKind[]) {
        for (const d of o.areas[k]) acts.push({ t: 'kongYuluo', choice: 'discard', dieId: d.id, kind: k });
      }
      return acts;
    }
    if (g.pending.kind === 'quanzhiAssign') {
      const pd = g.pending;
      return [{ t: 'quanzhiAssign', assign: quanzhiDefaultAssign(g.players[pd.player]) }];
    }
    if (g.pending.kind === 'kuyu') {
      return [
        { t: 'kuyuResolve', area: 'attack' },
        { t: 'kuyuResolve', area: 'defense' },
        { t: 'kuyuResolve', area: 'meditation' },
      ];
    }
    if (g.pending.kind === 'tiaolingPick') {
      // 默认（AI/测试）：选「全不同」，弃掉重复点数（每点数留 1 颗）
      const p = g.players[g.pending.player];
      const all = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation];
      const seen = new Set<number>();
      const discard: string[] = [];
      for (const d of all) {
        if (seen.has(d.value)) discard.push(d.id);
        else seen.add(d.value);
      }
      return [{ t: 'tiaolingResolve', pick: 'diff', dieIds: discard }];
    }
    if (g.pending.kind === 'endDiscard') {
      // 默认（AI/测试）：弃前 N 颗；真人由 UI 打开选择器自选
      const p = g.players[g.pending.player];
      const excess = Math.max(0, totalDice(p) - effectiveWill(p));
      const all = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation];
      return [{ t: 'endDiscardResolve', dieIds: all.slice(0, excess).map((d) => d.id) }];
    }
    if (g.pending.kind === 'wanzhangDiscard') {
      const p = g.players[g.pending.player];
      const all = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation];
      const n = Math.min(2, all.length);
      return [{ t: 'wanzhangDiscard', dieIds: all.slice(0, n).map((d) => d.id) }];
    }
    if (g.pending.kind === 'putiPick') {
      return [
        { t: 'putiResolve', accept: false },
        { t: 'putiResolve', accept: true },
      ];
    }
    if (g.pending.kind === 'shouhunCancel') {
      return [
        { t: 'shouhunCancel', cancel: true },
        { t: 'shouhunCancel', cancel: false },
      ];
    }
    if (g.pending.kind === 'ciBei') {
      return [
        { t: 'ciBei', accept: true },
        { t: 'ciBei', accept: false },
      ];
    }
    if (g.pending.kind === 'yuhuiPlace') {
      const areas: DiceKind[] = ['attack', 'defense', 'meditation'];
      const out: Action[] = [];
      for (const a of areas) for (const b of areas) out.push({ t: 'yuhuiPlace', areas: [a, b] });
      return out;
    }
    if (g.pending.kind === 'yingziPick') {
      return [1, 2, 3, 4, 5, 6].map((value) => ({ t: 'yingziPick' as const, value }));
    }
    if (g.pending.kind === 'yuanjianGain') {
      // 完整枚举：6 点数 × 3 区域（真人由 UI 面板呈现）
      const out: Action[] = [];
      for (let value = 1; value <= 6; value++) {
        for (const area of ['attack', 'defense', 'meditation'] as DiceKind[]) {
          out.push({ t: 'yuanjianGain', value, area });
        }
      }
      return out;
    }
    if (g.pending.kind === 'youdiMove') {
      // 不发动 + 默认（AI/测试）：取第一个非空区域的前 1 颗 → 另一个区域
      const p = g.players[g.pending.player];
      const out: Action[] = [{ t: 'youdiMove', cancel: true }];
      const areas: DiceKind[] = ['attack', 'defense', 'meditation'];
      for (const from of areas) {
        if (p.areas[from].length === 0) continue;
        const to = areas.find((k) => k !== from)!;
        out.push({ t: 'youdiMove', from, to, dieIds: [p.areas[from][0].id] });
        break;
      }
      return out;
    }
    if (g.pending.kind === 'shipeiPick') {
      const pd = g.pending;
      const out: Action[] = [{ t: 'shipeiPick', cancel: true }];
      if (pd.dieIds.length > 0) out.push({ t: 'shipeiPick', dieId: pd.dieIds[0], value: 1 });
      return out;
    }
    if (g.pending.kind === 'activationResolve') {
      const pd = g.pending;
      const p = g.players[pd.player];
      const a = p.artifacts.find((x) => x.id === pd.artifactId);
      const s = a?.skills.find((x) => x.kind === 'activation' && x.side === pd.side);
      if (!a || !s) return [{ t: 'advance' }];
      return [activationDefaultAction(g, p, a, s)];
    }
    if (g.pending.kind === 'weimu') {
      const pd = g.pending;
      const opp: PlayerId = pd.player === 'A' ? 'B' : 'A';
      const acts: Action[] = [{ t: 'weimu', accept: false }];
      const o = g.players[opp];
      for (const k of ['attack', 'defense', 'meditation'] as const) {
        for (const d of o.areas[k]) acts.push({ t: 'weimu', accept: true, dieId: d.id });
      }
      return acts;
    }
    if (g.pending.kind === 'zhihaiReroll') {
      const pd = g.pending;
      const p = g.players[pd.player];
      const all = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation];
      const acts: Action[] = [{ t: 'zhihaiReroll', dieIds: [] }];
      const pick = all.slice(0, Math.min(pd.x, all.length)).map((d) => d.id);
      if (pick.length > 0) acts.push({ t: 'zhihaiReroll', dieIds: pick });
      return acts;
    }
    const pp = g.players[g.pending.player];
    const acts: Action[] = [{ t: 'fengmang', accept: false }];
    // 034 破障（持续）：存放骰按分布视为攻击/冥想骰时也可作为「锋芒」的代价
    const held = heldAbilityDice(g, g.pending.player);
    const atkIds = [
      ...pp.areas.attack.map((d) => d.id),
      ...held.filter((h) => h.kind === 'attack').map((h) => h.id),
    ];
    const medIds = [
      ...pp.areas.meditation.map((d) => d.id),
      ...held.filter((h) => h.kind === 'meditation').map((h) => h.id),
    ];
    if (atkIds.length > 0 && medIds.length > 0) {
      for (const a of atkIds) {
        for (const m of medIds) {
          acts.push({ t: 'fengmang', accept: true, attackDieId: a, meditationDieId: m });
        }
      }
    }
    return acts;
  }

  if (g.phase === 'initialReroll') {
    const p = g.players[g.activePlayer];
    const all = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation].map((d) => d.id);
    const acts: Action[] = [{ t: 'advance' }];
    // T01「谨慎」：没有初始重掷步骤（此前仍会枚举出一个"点了就抛错"的「重掷」选项）
    const noStep = TACTIC_BY_ID[p.tactic ?? '']?.key === 'qingzhen';
    if (all.length && !noStep) acts.push({ t: 'reroll', dieIds: all });
    return acts;
  }

  if (g.pendingAttack) {
    const pa = g.pendingAttack;
    const defender: PlayerId = pa.attacker === 'A' ? 'B' : 'A';
    // 单人挑战：传奇按「防御规则」抵挡（伤害 < 门槛 → 不给任何抵挡动作＝自动不挡）
    const card =
      g.mode === 'challenge' && defender === 'B'
        ? CHALLENGES.find((c) => c.id === g.challenge?.cardId)
        : undefined;
    const legendBlocks = card == null || legendCanBlock(card, pa.value);
    const acts: Action[] = [{ t: 'block' }];
    if (!pa.unblockable && legendBlocks) {
      // 028 天罚：只能用指定类型的骰抵挡（白昼之火=冥想 / 陨落=攻击）；否则用防御骰
      const kind = pa.blockKind ?? 'defense';
      for (const d of g.players[defender].areas[kind]) {
        acts.push({ t: 'block', costSlots: [{ dieIds: [d.id] }] });
      }
      for (const h of heldAbilityDice(g, defender)) {
        if (h.kind === kind) acts.push({ t: 'block', costSlots: [{ dieIds: [h.id] }] });
      }
    }
    return acts;
  }

  // 挑战模式：轮到传奇且它已"停一下"→ 唯一可枚举动作＝推进一条（界面按节奏自动派发）
  if (
    g.mode === 'challenge' &&
    g.activePlayer === 'B' &&
    !g.pending &&
    !g.pendingAttack &&
    !g.attackQueue &&
    !g.virtualQueue &&
    g.challenge?.resumeAt != null
  ) {
    return [{ t: 'challengeStep' }];
  }

  const p = g.players[g.activePlayer];
  switch (g.phase) {
    case 'reroll': {
      const acts: Action[] = [{ t: 'advance' }];
      const allowance = g.extraReroll ? 1 : rerollAllowance(p);
      if (g.rerollUsed < allowance) {
        const speed = effectiveSpeed(p);
        const all = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation].sort(
          (a, b) => a.value - b.value,
        );
        const pick = all.slice(0, speed).map((d) => d.id);
        if (pick.length) acts.push({ t: 'reroll', dieIds: pick });
      }
      return acts;
    }
    case 'dustRise':
      return [...dustRiseActions(g, g.activePlayer), { t: 'advance' }];
    case 'main': {
      const acts: Action[] = [{ t: 'advance' }];
      // 战术牌 T16「潜伏」：双方各自的第一个回合内不能进行攻击（不产出任何 attack 动作）
      if (!attacksBanned(g)) {
        for (const d of p.areas.attack) acts.push({ t: 'attack', costSlots: [{ dieIds: [d.id] }] });
        // 034 破障（持续）：神器上存放的骰按分布视为攻击骰时，也可用于发起攻击
        for (const h of heldAbilityDice(g, g.activePlayer)) {
          if (h.kind === 'attack') acts.push({ t: 'attack', costSlots: [{ dieIds: [h.id] }] });
        }
        // 025 屠虎·奇袭（持续）：把「点数不在对方任意区域」的能力骰**视为攻击骰**发起攻击
        // （默认候选供 AI/测试；真人由 UI 显式选择）
        if (hasActiveSkill(p, 'tuohu.qixi')) {
          for (const k of ['defense', 'meditation'] as const) {
            for (const d of p.areas[k]) {
              if (canTreatAsAttack(g, g.activePlayer, d.id)) {
                acts.push({ t: 'attack', costSlots: [{ dieIds: [d.id], treated: true }] });
              }
            }
          }
        }
      }
      acts.push(...activateSkillActions(g, p));
      // 019 尘起赠予的免费额外尘起：可在主要阶段立即使用（不耗冥想骰、不占每回合 1 次）
      if (g.freeNoCostRise > 0) {
        for (const a of dustRiseActions(g, g.activePlayer)) {
          if (a.t === 'dustRise' && a.free) acts.push(a);
        }
      }
      return acts;
    }
    default:
      return [{ t: 'advance' }];
  }
}

/** 对第三列神器执行充能后，触发其「充能」技能效果（无论是否完成充能） */
/** 每种「待决策」对应的解算动作类型（替代手写白名单，新增 pending 时只需在此登记） */
const PENDING_ACTION: Record<Pending['kind'], Action['t']> = {
  challengePick: 'challengePick',
  caiyuliu: 'caiyuliu',
  c01Caiyuliu: 'c01Caiyuliu',
  fengmang: 'fengmang',
  guwangCharge: 'guwangCharge',
  guwangCancel: 'guwangCancel',
  shenhongKill: 'shenhongKill',
  aidao: 'aidao',
  dunwuHalve: 'dunwuHalve',
  dunwuPulse: 'dunwuPulse',
  leibaoReroll: 'leibaoReroll',
  dianxing: 'dianxing',
  leibao: 'leibao',
  activationResolve: 'skill',
  weimu: 'weimu',
  zhihaiReroll: 'zhihaiReroll',
  chenaiFreeRise: 'chenaiFreeRise',
  shouhunCancel: 'shouhunCancel',
  ciBei: 'ciBei',
  sijiChuxing: 'chuxingPick',
  weijuPay: 'weijuPay',
  gongzhenPick: 'gongzhenResolve',
  chargeResolve: 'skill',
  weiyaPick: 'weiyaPick',
  xianzhenPick: 'xianzhenResolve',
  hengguan: 'hengguan',
  hanguangPick: 'hanguangPick',
  quanzhiAssign: 'quanzhiAssign',
  kuyu: 'kuyuResolve',
  tiaolingPick: 'tiaolingResolve',
  endDiscard: 'endDiscardResolve',
  wanzhangDiscard: 'wanzhangDiscard',
  putiPick: 'putiResolve',
  kongYuluo: 'kongYuluo',
  anyexiongshen: 'anyexiongshen',
  bacheng: 'bacheng',
  fuchouRise: 'dustRise',
  wufaraoshu: 'wufaraoshu',
  yuanwu: 'yuanwu',
  shizushouhun: 'shizushouhun',
  shangjin: 'shangjin',
  dizuidaijianshu: 'dizuidaijianshu',
  nudengzuiren: 'nudengzuiren',
  duanexing: 'duanexing',
  tacticDice: 'tacticDice',
  tacticFirst: 'tacticFirst',
  tacticGuess: 'tacticGuess',
  yuhuiPlace: 'yuhuiPlace',
  yingziPick: 'yingziPick',
  yuanjianGain: 'yuanjianGain',
  youdiMove: 'youdiMove',
  shipeiPick: 'shipeiPick',
};

/**
 * 动作入口。外面包一层 `try/catch` 只服务于 L11「永恒女王」：该技能要求"取消该伤害与**所有尚待结算的
 * 效果和阶段**"，唯一可靠做法是让当前结算栈**立即展开**（抛 `YonghengQueenSignal`），在这里统一收尾
 * （清空待决策/多段队列/延后攻击 → 立即开始该玩家的全新回合）。其它异常**原样抛出**（绝不吞错）。
 */
export function applyAction(g: GameState, action: Action): GameState {
  fxReset(); // 动效旁路事件：每次动作开始清空
  try {
    return applyActionCore(g, action);
  } catch (e) {
    if (e instanceof YonghengQueenSignal) {
      runYonghengQueen(g, e.target);
      return g;
    }
    throw e;
  }
}

/** L11 永恒女王：取消一切 + 立即开始该玩家的一个**全新回合**（整局 1 次；标记在进入时已置） */
function runYonghengQueen(g: GameState, target: PlayerId): void {
  logLine(g, `${pname(target)} 「永恒女王」：取消该伤害与所有尚待结算的效果/阶段 → 立即开始 1 个新的回合`);
  fxSkillFired(g, target, 'aiwa.yonghengnvwang');
  g.legendOnceUsed.push(skillUseKey(target, 'aiwa.yonghengnvwang'));
  // 被打断的玩家＝当前回合玩家。永恒女王**只取消"将来触发的效果/阶段"**，不撤销已生效状态：
  //  - 不跑其"回合结束时触发"（遍野残杀不死、寒光骰不弃、残响不 −1）——这些是将来触发；
  //  - 但"只持续一回合"的状态照常到期（本回合攻击加成、023 畏惧的"下个回合减半"）；
  //  - 且其"有过一个回合"要记账（首回合标记置否），避免下个回合被误当首回合而跳过补充/重掷。
  const actor = g.activePlayer;
  const ap = g.players[actor];
  ap.buffs = ap.buffs.filter((b) => b.duration !== 'thisTurn');
  ap.attackHalvedNextTurn = false;
  g.firstRound[actor] = false;
  // 取消所有尚待结算：待决策链、待抵挡、多段攻击队列、延后攻击、额外重掷
  g.pending = null;
  g.pendingQueue = [];
  g.pendingAttack = null;
  g.attackQueue = null;
  g.virtualQueue = null;
  g.extraReroll = null;
  // 立即开始该玩家的一个全新回合（正常规则：补充按意志补骰、照常重掷；不是"补满"）
  g.activePlayer = target;
  g.firstRound[target] = false;
  g.turnIndex += 1;
  beginTurn(g);
}

function applyActionCore(g: GameState, action: Action): GameState {
  if (g.phase === 'gameOver') throw new Error('game is over');
  // L08「只为赏金而来」：该待决策下，除 `shangjin`（不发动/选技能）外还允许派发 `skill`
  //（选中的技能需要走它自己的选择器补全参数，最后以 `{t:'skill',…}` 提交）
  const shangjinSkill = g.pending?.kind === 'shangjin' && action.t === 'skill';
  if (g.pending && action.t !== PENDING_ACTION[g.pending.kind] && !shangjinSkill) {
    throw new Error('resolve pending decision first');
  }
  switch (action.t) {
    case 'tacticPick': {
      if (g.phase !== 'tactics') throw new Error('not tactics phase');
      const who = g.tacticQueue[0];
      if (!who) throw new Error('no tactic picker');
      if (!g.tacticHand.includes(action.id)) throw new Error(`not in tactic hand: ${action.id}`);
      g.players[who].tactic = action.id;
      logLine(g, `${pname(who)} 战术牌：选择「${TACTIC_BY_ID[action.id]?.name ?? action.id}」`);
      g.tacticQueue.shift();
      if (g.tacticQueue.length > 0) {
        g.activePlayer = g.tacticQueue[0];
        drawNextTacticHand(g); // 从剩余池抽 → 天然不含对方所选
      } else {
        // 双方都选完 → 再统一挂"战斗开始时"交互（T01 选骰 / T02 先手）；生命修正留到战前收口
        g.tacticHand = [];
        for (const id of ['A', 'B'] as PlayerId[]) applyTacticStart(g, id);
      }
      break;
    }
    case 'tacticDice': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'tacticDice') throw new Error('no tacticDice pending');
      const p = g.players[pd.player];
      const dist = emptyDistribution(p);
      if (!dist) throw new Error('no distribution');
      const will = effectiveWill(p);
      if (action.values.length !== will) throw new Error(`「谨慎」需恰好 ${will} 颗`);
      const counts: Record<DiceKind, number> = { attack: 0, defense: 0, meditation: 0 };
      for (const v of action.values) {
        if (!Number.isInteger(v) || v < 1 || v > 6) throw new Error(`非法点数：${v}`);
        counts[areaOf(v, dist)] += 1;
      }
      if (counts.attack > 4 || counts.defense > 4 || counts.meditation > 4) {
        throw new Error('「谨慎」：同类型能力骰不能超过 4 个');
      }
      // 先校验后落状态
      g.pending = null;
      p.areas.attack = [];
      p.areas.defense = [];
      p.areas.meditation = [];
      for (const v of action.values) placeDieByDistribution(p.areas, createDie(newDieId(`${pd.player}-`), v), dist);
      logLine(g, `${pname(pd.player)} 「谨慎」：自定初始能力骰点数（${action.values.join('、')}）`);
      break;
    }
    case 'tacticFirst': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'tacticFirst') throw new Error('no tacticFirst pending');
      if (action.who !== 'A' && action.who !== 'B') throw new Error('invalid first player');
      g.pending = null;
      applyFirstPlayer(g, action.who);
      logLine(
        g,
        `${pname(pd.player)} 「先机」：指定 ${pname(action.who)} 为先手；尘印标记归 ${pname(action.who === 'A' ? 'B' : 'A')}`,
      );
      break;
    }
    case 'tacticGuess': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'tacticGuess') throw new Error('no tacticGuess pending');
      if (action.who !== 'A' && action.who !== 'B') throw new Error('invalid guess player');
      g.pending = null;
      g.players[pd.player].tacticGuess = action.who;
      logLine(g, `${pname(pd.player)} 「远见」：猜测 ${pname(action.who)} 将最先降为 20 点或以下`);
      break;
    }
    case 'advance':
      doAdvance(g);
      break;
    case 'reroll': {
      if (g.phase === 'initialReroll') {
        const p = g.players[g.activePlayer];
        // T01「谨慎」：你没有对初始能力骰的重掷步骤
        if (TACTIC_BY_ID[p.tactic ?? '']?.key === 'qingzhen') {
          throw new Error('「谨慎」：没有初始重掷步骤');
        }
        const owned = new Set(
          [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation].map((d) => d.id),
        );
        if (new Set(action.dieIds).size !== action.dieIds.length) throw new Error('duplicate die id');
        for (const id of action.dieIds) if (!owned.has(id)) throw new Error(`not your die: ${id}`);
        withRng(g, (rng) => doReroll(g, g.activePlayer, action.dieIds, rng));
        finishInitialRerollStep(g);
        break;
      }
      if (g.phase !== 'reroll') throw new Error('not reroll phase');
      const p = g.players[g.activePlayer];
      const allowance = g.extraReroll ? 1 : rerollAllowance(p);
      if (g.rerollUsed >= allowance) throw new Error('reroll limit reached');
      const owned = new Set(
        [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation].map((d) => d.id),
      );
      if (action.dieIds.length > effectiveSpeed(p)) throw new Error('reroll exceeds speed');
      if (new Set(action.dieIds).size !== action.dieIds.length) throw new Error('duplicate die id');
      for (const id of action.dieIds) if (!owned.has(id)) throw new Error(`not your die: ${id}`);
      withRng(g, (rng) => doReroll(g, g.activePlayer, action.dieIds, rng));
      g.rerollUsed += 1;
      // 龙游万象（002 持续）：把重掷上限提到 2 → **第 2 次**重掷＝它多给的那次 → 弹它的气泡
      if (g.rerollUsed >= 2 && hasActiveSkill(g.players[g.activePlayer], 'youlong.wanxiang')) {
        fxSkillFired(g, g.activePlayer, 'youlong.wanxiang');
      }
      // 029 真言·全知（持续）：重掷阶段同样不按常规分布落区，由玩家重新分配全部能力骰
      if (hasActiveSkill(g.players[g.activePlayer], 'zhenyan.quanzhi')) {
        queuePending(g, { kind: 'quanzhiAssign', player: g.activePlayer });
      }
      break;
    }
    case 'leibaoReroll': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'leibaoReroll') throw new Error('no leibaoReroll pending');
      g.pending = null;
      if (action.accept) {
        g.extraReroll = { player: pd.player, resume: g.activePlayer };
        g.activePlayer = pd.player;
        g.rerollUsed = 0;
        g.phase = 'reroll';
        logLine(g, `${pname(pd.player)} 发动「雷暴」：插入一个额外重掷阶段（重掷 1 次，骰数 ≤ 速度）`);
        fxSkillFired(g, pd.player, 'minglei.leibao.trigger');
      } else {
        g.phase = 'dustRise';
        logLine(g, `${pname(pd.player)} 放弃「雷暴」的额外重掷`);
      }
      break;
    }
    case 'dianxing': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'dianxing') throw new Error('no dianxing pending');
      if (action.accept === false) {
        g.pending = null;
        logLine(g, `${pname(pd.player)} 不发动「电刑」`);
        pumpAttackQueue(g);
        break;
      }
      const ids = action.dieIds ?? [];
      if (ids.length !== 2) throw new Error('电刑需消耗恰好 2 个冥想骰');
      if (new Set(ids).size !== ids.length) throw new Error('电刑的 2 个冥想骰不可重复');
      for (const id of ids) {
        const info = abilityDieInfo(g, pd.player, id);
        if (!info || info.kind !== 'meditation') throw new Error(`电刑需要冥想骰: ${id}`);
      }
      g.pending = null;
      fxSkillFired(g, pd.player, 'minglei.dianxing'); // 013 / A08（按持有者实际 key）
      fxSkillFired(g, pd.player, 'minglei.alt.dianxing');
      // 「消耗 2 个冥想骰」→ 走 paySlots（与「使用/消耗」语义一致：支持 010 置换 / 034 破障）
      const eff = paySlots(
        g,
        pd.player,
        [{ kind: 'meditation' }, { kind: 'meditation' }],
        ids.map((id) => ({ dieIds: [id] })),
        undefined,
        'skill',
      );
      const pickedVals = eff.map((e) => e.value);
      const vals = pd.values ?? dianxingValuesOf(g.players[pd.player]) ?? [1, 2, 3];
      // §19⑨ 多段攻击源：013 电刑 / A08 将至的电刑（attackQueue）
      g.attackQueue = { player: pd.player, values: [...vals] };
      logLine(
        g,
        `${pname(pd.player)} 发动「电刑」：消耗 2 个冥想骰（${pickedVals.join('/')}点），依次以 ${vals.join('、')} 点各进行一次攻击`,
      );
      pumpAttackQueue(g);
      break;
    }
    case 'leibao': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'leibao') throw new Error('no leibao pending');
      const p = g.players[pd.player];
      if (action.accept === false) {
        g.pending = null;
        logLine(g, `${pname(pd.player)} 不发动「雷暴」`);
        pumpAttackQueue(g);
        break;
      }
      const ids = action.dieIds ?? [];
      if (ids.length > 2) throw new Error('雷暴最多移动 2 个冥想骰');
      assertOwnMeditationDice(p, ids);
      g.pending = null;
      if (ids.length > 0) moveDice(g, pd.player, ids, 'attack');
      logLine(
        g,
        `${pname(pd.player)} 发动「雷暴」：将 ${ids.length} 个冥想骰移动到攻击骰区（保留点数）`,
      );
      fxSkillFired(g, pd.player, 'minglei.leibao.trigger');
      pumpAttackQueue(g);
      break;
    }
    case 'dustRise': {
      // 019 尘起赠予的免费额外尘起（可在主要阶段立即使用，不耗冥想骰、不占每回合 1 次）
      // L05 复仇之灵：强制额外尘起（同上，且不消耗 019 的计数）
      if (action.fuchou) {
        // 强制额外尘起：无阶段/计数门槛
      } else if (action.free) {
        if (g.freeNoCostRise <= 0) throw new Error('no free dust rise available');
      } else if (g.phase !== 'dustRise') {
        throw new Error('not dust rise phase');
      }
      // L05 复仇之灵：强制尘起**可能属于"非当前回合玩家"**（如对方回合中其生命十位数变化）→ 一切按**归属玩家**取
      const who: PlayerId =
        action.fuchou && g.pending && g.pending.kind === 'fuchouRise' ? g.pending.player : g.activePlayer;
      const p = g.players[who];
      // 第三列：只有「本次充能完成激活」时才结算该神器的「激活」技能（续充不重复结算）
      const beforeRise = p.artifacts.find((x) => x.id === action.artifactId);
      const wasFullyCharged = beforeRise?.column === 3 && beforeRise.chargeLayer >= (beforeRise.chargeReq ?? 0);
      const wasSwitching = beforeRise?.activeMarkerSide != null; // 本次是"切换"（而非首次激活）
      if (action.fuchou) {
        // L05 复仇之灵：强制额外尘起——不耗冥想骰、不占次数、不消耗 019 的 freeNoCostRise；结算该待决策
        if (g.pending && g.pending.kind === 'fuchouRise') g.pending = null;
      } else if (action.free) {
        g.freeNoCostRise -= 1;
      } else if (action.useSeal) {
        if (!p.hasDustSeal) throw new Error('no dust seal');
        p.hasDustSeal = false;
      } else {
        if (g.freeDustRise > 0) {
          g.freeDustRise -= 1;
        } else if (g.dustRiseNormalCount < (hasActiveSkill(p, 'ying.canying') ? 2 : 1)) {
          g.dustRiseNormalCount += 1;
          // 残影（L02 持续）：把尘起上限提到 2 → 第 2 次＝它多给的那次 → 弹「残影」
          if (g.dustRiseNormalCount >= 2) fxSkillFired(g, who, 'ying.canying');
        } else if (
          // 战术牌 T12「激进」：你自己的**第一个尘起阶段**里，可对**第三列**神器额外充能 1 次（正常支付冥想骰）
          g.firstRound[who] &&
          TACTIC_BY_ID[p.tactic ?? '']?.key === 'jijin' &&
          !p.tacticOnceUsed &&
          beforeRise?.column === 3
        ) {
          p.tacticOnceUsed = true;
          fxTacticFired(g, who); // 动效旁路：战术栏弹「激进」
          logLine(g, `${pname(who)} 「激进」：第一个尘起阶段 → 对第三列神器进行 1 次额外充能`);
        } else {
          throw new Error('no dust rise action available');
        }
        assertConversionAllowed(g, who, action.costSlots);
        if (!action.costSlots || action.costSlots.length === 0) throw new Error('costSlots required');
        paySlots(g, who, [{ kind: 'meditation' }], action.costSlots, undefined, 'dustRise');
      }
      const desc = applyDustRiseToArtifact(g, who, action.artifactId, action.side);
      logLine(g, `${pname(who)} 尘起：${desc}${action.useSeal ? '（使用尘印标记）' : ''}`);
      // 动效旁路：尘起"开"气泡（切换 / 激活 / 充能）。第三列＝充能（侧按 'only' 取名）
      fxPush({
        kind: 'rise',
        player: who,
        artifactId: action.artifactId,
        side: beforeRise?.column === 3 ? 'only' : (action.side ?? 'left'),
        mode: beforeRise?.column === 3 ? 'charge' : wasSwitching ? 'switch' : 'activate',
      });
      // 战术牌 T10「迂回」：你**第一次切换**一件**不含「激活」技能**的神器后 → 获得 2 个 1 点能力骰（待放置）
      if (
        wasSwitching &&
        beforeRise &&
        !beforeRise.skills.some((s) => s.kind === 'activation') &&
        TACTIC_BY_ID[p.tactic ?? '']?.key === 'yuhui' &&
        !p.tacticOnceUsed
      ) {
        p.tacticOnceUsed = true;
        queuePending(g, { kind: 'yuhuiPlace', player: who });
        fxTacticFired(g, who);
        logLine(g, `${pname(who)} 「迂回」：第一次切换神器 → 获得 2 个 1 点能力骰（待放置）`);
      }
      runChargeSkill(g, who, action.artifactId, () => endMainPhase(g));
      // 「激活」类技能：装填到该侧的瞬间立即强制结算（016 虚无形态 / 014 净化·数罪并罚 / 020 兽魂 / 021 决意）
      // 第三列续充（wasFullyCharged）不再重复结算「激活」
      const justArmed = g.players[who].artifacts.find((x) => x.id === action.artifactId);
      if (!wasFullyCharged && (justArmed?.armedSide === 'left' || justArmed?.armedSide === 'right')) {
        resolveActivationOnArm(g, who, action.artifactId, justArmed.armedSide);
      }
      // L10 传奇面板·涤罪大剑术（触发）：**进行 1 次尘起行动后**，若**第一列与第二列神器的激活标记在同一侧**
      //（按"列"判定，异相 A05 等同样适用）且对方能给出"2 颗**种类不相同**的能力骰" → 由持有者决定是否弃置。
      if (hasActiveSkill(p, 'mate.dizuidaijianshu')) {
        const c1 = p.artifacts.find((a) => a.column === 1);
        const c2 = p.artifacts.find((a) => a.column === 2);
        const sameSide = c1?.activeMarkerSide != null && c1.activeMarkerSide === c2?.activeMarkerSide;
        if (sameSide) {
          const opp = g.players[who === 'A' ? 'B' : 'A'];
          const oppKinds = new Set(
            [...opp.areas.attack, ...opp.areas.defense, ...opp.areas.meditation].map((d) => d.kind),
          );
          if (oppKinds.size >= 2) queuePending(g, { kind: 'dizuidaijianshu', player: who });
        }
      }
      g.dustRiseActed = true;
      break;
    }
    case 'attack':
      if (g.phase !== 'main') throw new Error('not main phase');
      if (g.pendingAttack) throw new Error('pending attack unresolved');
      if (attacksBanned(g)) throw new Error('「潜伏」：双方各自的第一个回合内不能进行攻击');
      assertConversionAllowed(g, g.activePlayer, action.costSlots);
      assertTreatedAllowed(g, g.activePlayer, action.costSlots);
      // 027 寒光·必杀：使用攻击骰前先决定是否使用神器上的骰子（先于 022；两者仅可能在非预设模式共存）
      if (canUseHanguang(g, g.activePlayer)) {
        g.pending = { kind: 'hanguangPick', player: g.activePlayer, costSlots: action.costSlots };
        break;
      }
      // 022 死契·处刑通牒：使用攻击骰前必须先决定是否扣计数（FAQ 22.2.1：优先于抵挡与「灵能屏障」）
      if (hasActiveSkill(g.players[g.activePlayer], 'siji.chuxing') && (artifactWithSkill(g.players[g.activePlayer], 'siji.chuxing')?.count ?? 0) >= 1) {
        g.pending = { kind: 'sijiChuxing', player: g.activePlayer, costSlots: action.costSlots };
        break;
      }
      doAttack(g, g.activePlayer, action.costSlots);
      break;
    case 'block': {
      if (!g.pendingAttack) throw new Error('no pending attack');
      const defender: PlayerId = g.pendingAttack.attacker === 'A' ? 'B' : 'A';
      assertConversionAllowed(g, defender, action.costSlots);
      resolveBlock(g, action.costSlots);
      break;
    }
    case 'caiyuliu': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'caiyuliu') throw new Error('no caiyuliu pending');
      if (action.to) {
        g.players[pd.player].areas[action.to].push({ id: pd.dieId, value: pd.value, kind: action.to });
        g.caiyuliuUsed += 1;
        logLine(
          g,
          `${pname(pd.player)} 发动「裁雨流」：将 ${pd.value} 点骰移到${
            action.to === 'defense' ? '防御' : '冥想'
          }骰区`,
        );
        fxSkillFired(g, pd.player, 'yuqie.caiyuliu');
      } else {
        logLine(g, `${pname(pd.player)} 放弃裁雨流`);
      }
      g.pending = null;
      break;
    }
    case 'c01Caiyuliu': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'c01Caiyuliu') throw new Error('no c01Caiyuliu pending');
      if (!action.accept) {
        g.pending = null;
        logLine(g, `${pname(pd.player)} 放弃「极之境·裁雨流」`);
        break;
      }
      const p = g.players[pd.player];
      const dist = emptyDistribution(p);
      if (!dist) throw new Error('「极之境·裁雨流」需要第二列分布');
      g.pending = null;
      withRng(g, (rng) => {
        const v = rng.rollDie();
        const kind = areaOf(v, dist);
        const die = { id: pd.dieId, value: v, kind }; // **复用攻击骰 id**（界面才能"中间重掷翻面 → 飞回区域"，而不是消失+新骰出现）
        p.areas[kind].push(die);
        const cn = kind === 'attack' ? '攻击' : kind === 'defense' ? '防御' : '冥想';
        logLine(g, `${pname(pd.player)} 发动「极之境·裁雨流」：将该攻击骰重新投掷为 ${v} 点，移回${cn}骰区`);
        fxSkillFired(g, pd.player, 'c01.caiyuliu');
        offerAdapt(g, pd.player, [die], true); // T18「适应」
      });
      break;
    }
    case 'fengmang': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'fengmang') throw new Error('no fengmang pending');
      if (action.accept) {
        if (!action.attackDieId || !action.meditationDieId) throw new Error('missing dice');
        // 「消耗 1 攻击骰 + 1 冥想骰」→ 走 paySlots（支持 010 置换 / 034 破障）
        const eff = paySlots(
          g,
          pd.player,
          [{ kind: 'attack' }, { kind: 'meditation' }],
          [{ dieIds: [action.attackDieId] }, { dieIds: [action.meditationDieId] }],
          undefined,
          'skill',
        );
        const av = eff[0].value;
        const mv = eff[1].value;
        applyLifeLoss(g, pd.defenderId, pd.value);
        logLine(
          g,
          `${pname(pd.player)} 发动「锋芒」：消耗 1 颗攻击骰（${av}点）与 1 颗冥想骰（${mv}点），取消抵挡并追加 2 点真实伤害`,
        );
        fxSkillFired(g, pd.player, 'buxiang.fengmang.trigger'); // 先发（兼作真伤白墨线锚点）
        if ((g.phase as string) !== 'gameOver') dealTrueDamage(g, pd.defenderId, 2, pd.player);
        // L02 传奇面板·暗夜凶神（触发）：通过「锋芒」取消对方防御骰后 → 可选使「不祥」计数 +1（最高 3 层）
        if ((g.phase as string) !== 'gameOver') {
          const atkP = g.players[pd.player];
          const buxiang = atkP.artifacts.find((x) => x.skills.some((s) => s.key === 'buxiang.fengmang'));
          if (
            hasActiveSkill(atkP, 'ying.anyexiongshen') &&
            buxiang &&
            buxiang.count < (buxiang.countCap ?? 3)
          ) {
            queuePending(g, { kind: 'anyexiongshen', player: pd.player });
          }
        }
      } else {
        logLine(g, `${pname(pd.player)} 放弃锋芒`);
      }
      g.pending = null;
      pumpAttackQueue(g);
      break;
    }
    case 'guwangCharge': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'guwangCharge') throw new Error('no guwangCharge pending');
      const opponent: PlayerId = pd.player === 'A' ? 'B' : 'A';
      if (action.dieId) {
        const die = g.players[opponent].areas.attack.find((d) => d.id === action.dieId);
        if (!die) throw new Error('not an opponent attack die');
        const old = setDieValue(g, opponent, action.dieId, 1);
        logLine(g, `${pname(pd.player)} 「高塔铁幕」：将 ${pname(opponent)} 的 1 颗攻击骰由 ${old} 点变更为 1 点`);
      } else {
        logLine(g, `${pname(pd.player)} 「高塔铁幕」：不变更攻击骰`);
      }
      g.pending = null;
      break;
    }
    case 'guwangCancel': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'guwangCancel') throw new Error('no guwangCancel pending');
      const dieId = action.defenseDieId;
      // 支付填法：显式 costSlots（010 置换 2 颗顶 1）优先；否则单颗 defenseDieId
      const fills: SlotFill[] | null =
        action.costSlots && action.costSlots.length === 1
          ? action.costSlots
          : dieId
            ? [{ dieIds: [dieId] }]
            : null;
      let consumed: { value: number; converted: boolean } | null = null;
      if (action.cancel && fills) {
        const firstId = fills[0].dieIds[0];
        const info = abilityDieInfo(g, pd.player, firstId);
        const convertible = fills[0].dieIds.length === 2;
        if (convertible || (info && info.kind === 'defense')) {
          // 「消耗 1 个防御骰」→ 走 paySlots（支持 010 置换 / 034 破障）
          const eff = paySlots(g, pd.player, [{ kind: 'defense' }], fills, undefined, 'skill');
          consumed = { value: eff[0].value, converted: convertible };
        }
      }
      if (consumed) {
        logLine(
          g,
          `${pname(pd.player)} 「高塔铁幕」：消耗 1 个防御骰（${consumed.value}点${consumed.converted ? '·置换' : ''}），取消 ${pd.amount} 点真实伤害`,
        );
      } else {
        applyDeferredTrueDamage(g, pd.player, pd.amount);
      }
      g.pending = null;
      break;
    }
    case 'shenhongKill': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'shenhongKill') throw new Error('no shenhongKill pending');
      if (action.accept) {
        const opponent: PlayerId = pd.player === 'A' ? 'B' : 'A';
        g.pending = null;
        logLine(g, `${pname(pd.player)} 发动「杀意」：造成 3 点真实伤害，然后回复 2 点生命`);
        fxSkillFired(g, pd.player, 'shenhong.kill');
        dealTrueDamage(g, opponent, 3, pd.player);
        heal(g, pd.player, 2);
      } else {
        logLine(g, `${pname(pd.player)} 放弃杀意`);
        g.pending = null;
      }
      break;
    }
    case 'aidao': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'aidao') throw new Error('no aidao pending');
      if (!action.accept) {
        logLine(g, `${pname(pd.player)} 放弃「哀悼」`);
        g.pending = null;
        break;
      }
      const opponent: PlayerId = pd.player === 'A' ? 'B' : 'A';
      const defense = g.players[opponent].areas.defense;
      // "即使不能完整弃置仍需尽可能执行"：对方有防御骰则**必须**指定要弃置的那一颗（由持有者选择）。
      // 先校验再改状态（非法动作不得改变状态）。
      if (defense.length > 0 && (!action.defenseDieId || !defense.some((d) => d.id === action.defenseDieId))) {
        throw new Error('「哀悼」需指定要弃置的对方防御骰');
      }
      g.pending = null;
      logLine(g, `${pname(pd.player)} 发动「哀悼」：造成 2 点真实伤害，然后弃置对方的 1 个防御骰`);
      fxSkillFired(g, pd.player, 'shenhong.alt.aidao');
      dealTrueDamage(g, opponent, 2, pd.player);
      // 弃置对方 1 个防御骰（持有者已选定；034 破障的存放骰不属区域 → 不可选）
      if (defense.length > 0 && action.defenseDieId) {
        const die = defense.find((d) => d.id === action.defenseDieId)!;
        consumeDice(g, g.players[opponent], 'defense', [action.defenseDieId]);
        logLine(g, `${pname(pd.player)} 弃置 ${pname(opponent)} 的 1 个防御骰（${die.value} 点）`);
      }
      break;
    }
    case 'dunwuHalve': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'dunwuHalve') throw new Error('no dunwuHalve pending');
      const dieId = action.meditationDieId;
      // 支付填法：显式 costSlots（010 置换 2 颗顶 1）优先；否则单颗 meditationDieId
      const fills: SlotFill[] | null =
        action.costSlots && action.costSlots.length === 1
          ? action.costSlots
          : dieId
            ? [{ dieIds: [dieId] }]
            : null;
      let paid = false;
      if (action.accept && fills) {
        const firstId = fills[0].dieIds[0];
        const info = abilityDieInfo(g, pd.player, firstId);
        const convertible = fills[0].dieIds.length === 2;
        if (convertible || (info && info.kind === 'meditation')) {
          // 「消耗 1 个冥想骰」→ 走 paySlots（支持 010 置换 / 034 破障）
          const eff = paySlots(g, pd.player, [{ kind: 'meditation' }], fills, undefined, 'skill');
          paid = true;
          // 动效旁路：011 的冥想骰飞到中间、与攻击骰**并排** → 只它消失（攻击骰留位等抵挡）
          fxPush({ kind: 'attackJoin', player: pd.player, mode: 'spend', dieIds: fills[0].dieIds, value: eff[0].value });
        }
      }
      if (paid) {
        fxSkillFired(g, pd.player, 'dunwu.barrier.trigger');
        if (g.pendingAttack) {
          // 统一减半入口：同种削减不叠加（屏障 / 021 满计数 / 023 畏惧 只减半一次，FAQ 21.1.5）
          const ok = halveAttackDamage(g.pendingAttack, '灵能屏障');
          logLine(
            g,
            ok
              ? `${pname(pd.player)} 「灵能屏障」：消耗 1 个冥想骰，伤害减半为 ${g.pendingAttack.value}`
              : `${pname(pd.player)} 「灵能屏障」：本次攻击已在减半状态，不再叠加（同种削减不叠加）`,
          );
        }
      } else {
        logLine(g, `${pname(pd.player)} 放弃灵能屏障`);
      }
      g.pending = null;
      break;
    }
    case 'dunwuPulse': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'dunwuPulse') throw new Error('no dunwuPulse pending');
      if (action.accept) {
        const opponent: PlayerId = pd.player === 'A' ? 'B' : 'A';
        g.pending = null;
        logLine(g, `${pname(pd.player)} 发动「灵能脉冲」：造成 ${pd.amount} 点真实伤害`);
        fxSkillFired(g, pd.player, 'dunwu.pulse.trigger');
        dealTrueDamage(g, opponent, pd.amount, pd.player);
        g.dunwuPulseUsedThisTurn = true;
      } else {
        logLine(g, `${pname(pd.player)} 放弃灵能脉冲`);
        g.pending = null;
      }
      break;
    }
    case 'weimu': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'weimu') throw new Error('no weimu pending');
      g.pending = null;
      if (action.accept === false) {
        logLine(g, `${pname(pd.player)} 不发动「帷幕」`);
        break;
      }
      const dieId = action.dieId;
      if (!dieId) throw new Error('missing die');
      const opp: PlayerId = pd.player === 'A' ? 'B' : 'A';
      const found = findDieOf(g, opp, dieId);
      if (!found) throw new Error(`not ${pname(opp)}'s ability die: ${dieId}`);
      const val = found.die.value;
      logLine(g, `${pname(pd.player)} 发动「帷幕」：受到 2 点真实伤害，弃置 ${pname(opp)} 的 1 个能力骰（${val}点）`);
      fxSkillFired(g, pd.player, 'youming.weimu');
      dealTrueDamage(g, pd.player, 2, pd.player);
      consumeDice(g, g.players[opp], found.kind, [dieId]);
      break;
    }
    case 'zhihaiReroll': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'zhihaiReroll') throw new Error('no zhihaiReroll pending');
      const ids = action.dieIds;
      if (ids.length > pd.x) throw new Error(`最多重掷 ${pd.x} 个能力骰`);
      if (new Set(ids).size !== ids.length) throw new Error('duplicate die id');
      for (const id of ids) {
        if (!findDieOf(g, pd.player, id)) throw new Error(`not your ability die: ${id}`);
      }
      g.pending = null;
      if (ids.length === 0) {
        logLine(g, `${pname(pd.player)} 「漆黑绽放」：不重掷`);
        break;
      }
      withRng(g, (rng) => doReroll(g, pd.player, ids, rng));
      break;
    }
    case 'chenaiFreeRise': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'chenaiFreeRise') throw new Error('no chenaiFreeRise pending');
      g.pending = null;
      if (action.accept) {
        g.freeNoCostRise += 1;
        logLine(g, `${pname(pd.player)} 「尘起」：获得 1 次无需冥想骰的额外尘起行动（可在主要阶段立即使用）`);
        fxSkillFired(g, pd.player, 'chenai.rise');
      } else {
        logLine(g, `${pname(pd.player)} 放弃「尘起」的额外尘起行动`);
      }
      break;
    }
    case 'bacheng': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'bacheng') throw new Error('no bacheng pending');
      g.pending = null;
      if (action.accept) {
        fxSkillFired(g, pd.player, 'batton.bacheng'); // 按「发动拔城」那一下才弹「拔城」技能名
        const p = g.players[pd.player];
        virtualAttack(g, pd.player, 5, { skill: '拔城', owner: pd.player });
        logLine(g, `${pname(pd.player)} 「拔城」：视为以 5 点进行 1 次攻击`);
        const zz = p.artifacts.find((a) =>
          a.skills.some((s) => s.key === 'zhuzai.sweep' || s.key === 'zhuzai.smash'),
        );
        if (zz) {
          const from = zz.activeMarkerSide;
          const to: 'left' | 'right' = from === 'right' ? 'left' : 'right';
          zz.activeMarkerSide = to;
          zz.armedSide = null;
          zz.armedTurn = -1;
          logLine(g, `${pname(pd.player)} 「拔城」：切换「${zz.name}」的技能（${from ?? '未激活'} → ${to}）`);
          // 动效旁路：切换「主宰」技能 → 主宰卡上弹「切换」小气泡（与尘起切换同款，此前是静默换面）
          fxPush({ kind: 'rise', player: pd.player, artifactId: zz.id, side: to, mode: 'switch' });
        }
        pumpAttackQueue(g);
      } else {
        logLine(g, `${pname(pd.player)} 放弃「拔城」`);
      }
      break;
    }
    case 'yuanwu': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'yuanwu') throw new Error('no yuanwu pending');
      const p2 = g.players[pd.player];
      const dieId = action.dieId ?? '';
      let from: DiceKind | null = null;
      for (const k of ['attack', 'defense', 'meditation'] as DiceKind[]) {
        if (p2.areas[k].some((d) => d.id === dieId)) {
          from = k;
          break;
        }
      }
      const to = action.to;
      if (from == null) throw new Error('圆舞：不是你的能力骰');
      if (to !== 'attack' && to !== 'defense' && to !== 'meditation') throw new Error('圆舞：目标区域非法');
      if (to === from) throw new Error('圆舞：必须移动到「另一个」区域');
      g.pending = null;
      moveDice(g, pd.player, [dieId], to);
      const cn = to === 'attack' ? '攻击' : to === 'defense' ? '防御' : '冥想';
      logLine(g, `${pname(pd.player)} 「圆舞」：将 1 个能力骰移动到${cn}骰区`);
      break;
    }
    case 'shangjin': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'shangjin') throw new Error('no shangjin pending');
      if (action.decline || !action.artifactId) {
        g.pending = null;
        logLine(g, `${pname(pd.player)} 不发动「只为赏金而来」`);
        break;
      }
      // 选中某个技能：它还需要**自己的选择器**补全参数 → UI 会先打开选择器，再派发 `{t:'skill',…}`
      // （`case 'skill'` 会识别 `shangjin` 待决策 → 按"不计入每回合上限"执行并清空本待决策）
      throw new Error('「只为赏金而来」：请通过选择器指定该技能的参数');
    }
    case 'dizuidaijianshu': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'dizuidaijianshu') throw new Error('no dizuidaijianshu pending');
      if (action.accept === false) {
        g.pending = null;
        logLine(g, `${pname(pd.player)} 不发动「涤罪大剑术」`);
        break;
      }
      const ids = action.dieIds ?? [];
      if (ids.length !== 2) throw new Error('「涤罪大剑术」：需选择对方 2 个能力骰');
      if (new Set(ids).size !== ids.length) throw new Error('duplicate die id');
      const oppId2: PlayerId = pd.player === 'A' ? 'B' : 'A';
      const byKind: Partial<Record<DiceKind, string[]>> = {};
      for (const id of ids) {
        const found = findDieOf(g, oppId2, id);
        if (!found) throw new Error(`not an opponent ability die: ${id}`);
        (byKind[found.kind] ??= []).push(id);
      }
      if (Object.keys(byKind).length !== 2) throw new Error('「涤罪大剑术」：2 颗骰的种类必须不相同');
      g.pending = null;
      consumeDiceByKind(g, g.players[oppId2], byKind); // 一次效果（多类型）→ 对方「雨落狂流」只 +1
      logLine(g, `${pname(pd.player)} 「涤罪大剑术」：弃置 ${pname(oppId2)} 的 2 颗能力骰（种类不相同）`);
      fxSkillFired(g, pd.player, 'mate.dizuidaijianshu');
      break;
    }
    case 'nudengzuiren': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'nudengzuiren') throw new Error('no nudengzuiren pending');
      const oppId2: PlayerId = pd.player === 'A' ? 'B' : 'A';
      g.pending = null;
      if (!action.accept) {
        const healed = applyHeal(g, pd.player, pd.amount);
        logLine(
          g,
          `${pname(pd.player)} 「汝等罪人」：正常回复 ${healed} 点生命（技能为 ${pd.amount} 点，受生命上限限制）`,
        );
        break;
      }
      logLine(
        g,
        `${pname(pd.player)} 「汝等罪人」：放弃回复 ${pd.amount} 点生命，改为对 ${pname(oppId2)} 造成 ${pd.amount} 点真实伤害`,
      );
      fxSkillFired(g, pd.player, 'mate.nudengzuiren'); // 先发（兼作真伤白墨线锚点），再落血
      dealTrueDamage(g, oppId2, pd.amount, pd.player); // 真伤：source＝你（对方 009 等可取消）
      break;
    }
    case 'duanexing': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'duanexing') throw new Error('no duanexing pending');
      const oppId3: PlayerId = pd.player === 'A' ? 'B' : 'A';
      if (!action.accept) {
        logLine(g, `${pname(pd.player)} 「闻我名者断恶行」：不发动`);
        g.pending = null;
        break;
      }
      const dieId = action.dieId;
      if (!dieId) throw new Error('「闻我名者断恶行」需指定要弃置的攻击骰');
      const opp = g.players[oppId3];
      const found = opp.areas.attack.find((d) => d.id === dieId);
      if (!found) throw new Error(`not opponent attack die: ${dieId}`); // 先校验（神上存放骰不算）
      consumeDice(g, opp, 'attack', [dieId]); // 弃置（不走 paySlots）
      logLine(
        g,
        `${pname(pd.player)} 「闻我名者断恶行」：弃置 ${pname(oppId3)} 的 1 个攻击骰（${found.value} 点）`,
      );
      fxSkillFired(g, pd.player, 'miyun.duanexing');
      g.pending = null;
      break;
    }
    case 'shizushouhun': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'shizushouhun') throw new Error('no shizushouhun pending');
      const p2 = g.players[pd.player];
      const card = p2.artifacts.find((a) => a.id === pd.artifactId);
      if (!card) throw new Error(`no artifact: ${pd.artifactId}`);
      if (!action.accept) {
        g.pending = null;
        logLine(g, `${pname(pd.player)} 不发动「始祖兽魂」：保留「${card.name}」计数 2`);
        break;
      }
      // 先校验后落状态：必须恰好 1 个「冥想骰位」的填法（010 置换允许 2 顶 1；预设下 L07 与 010 不可能共存，仅为通用性）
      const fills = action.costSlots ?? [];
      const ids = fills[0]?.dieIds ?? [];
      if (fills.length !== 1 || ids.length < 1) throw new Error('「始祖兽魂」：需指定 1 个冥想骰位');
      if (ids.length === 2) assertConversionAllowed(g, pd.player, fills);
      g.pending = null;
      paySlots(g, pd.player, [{ kind: 'meditation' }], fills, undefined, 'skill');
      card.count = 3;
      logLine(g, `${pname(pd.player)} 「始祖兽魂」：额外消耗 1 个冥想骰 → 将「${card.name}」的计数重设为 3`);
      fxSkillFired(g, pd.player, 'nisa.shizushouhun');
      break;
    }
    case 'wufaraoshu': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'wufaraoshu') throw new Error('no wufaraoshu pending');
      const opp: PlayerId = pd.player === 'A' ? 'B' : 'A';
      const o = g.players[opp];
      if (action.choice === 'decline') {
        g.pending = null;
        logLine(g, `${pname(pd.player)} 「无法饶恕」：不弃置`);
        break;
      }
      const dieId = action.dieId ?? '';
      if (!o.areas.defense.some((d) => d.id === dieId && d.value === pd.value)) {
        throw new Error('无法饶恕：对方没有该点数的防御骰');
      }
      g.pending = null;
      consumeDice(g, o, 'defense', [dieId]); // 弃置（非支付）
      logLine(g, `${pname(pd.player)} 「无法饶恕」：弃置 ${pname(opp)} 的 1 个 ${pd.value} 点防御骰`);
      fxSkillFired(g, pd.player, 'zoray.wufaraoshu');
      break;
    }
    case 'anyexiongshen': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'anyexiongshen') throw new Error('no anyexiongshen pending');
      g.pending = null;
      if (action.accept) {
        const p = g.players[pd.player];
        const card = p.artifacts.find((a) => a.skills.some((s) => s.key === 'buxiang.fengmang'));
        if (card) {
          const before = card.count;
          card.count = Math.min(card.countCap ?? 3, card.count + 1);
          logLine(g, `${pname(pd.player)} 「暗夜凶神」：使「不祥」的计数 +1（${before} → ${card.count}）`);
          fxSkillFired(g, pd.player, 'ying.anyexiongshen');
        }
      } else {
        logLine(g, `${pname(pd.player)} 放弃「暗夜凶神」`);
      }
      break;
    }
    case 'kongYuluo': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'kongYuluo') throw new Error('no kongYuluo pending');
      const opp: PlayerId = pd.player === 'A' ? 'B' : 'A';
      const o = g.players[opp];
      if (action.choice === 'decline') {
        g.pending = null;
        logLine(g, `${pname(pd.player)} 「雨落狂流」：不选择执行`);
        break;
      }
      if (action.choice === 'gain') {
        const kind = action.kind;
        if (kind !== 'attack' && kind !== 'defense' && kind !== 'meditation') {
          throw new Error('雨落狂流：落区类型非法');
        }
        g.pending = null;
        withRng(g, (rng) => {
          const die = gainRandomDice(g, pd.player, kind, 1, rng)[0];
          const cn = kind === 'attack' ? '攻击' : kind === 'defense' ? '防御' : '冥想';
          logLine(g, `${pname(pd.player)} 「雨落狂流」：获得 1 个随机点数能力骰（${die.value}）并移入${cn}骰区`);
        });
        break;
      }
      // discard：弃置对方的 1 个能力骰（骰主＝对方 → 触发**对方**的「雨落狂流」，口径 (B)：不看是谁执行的）
      const dieId = action.dieId;
      let found: { kind: DiceKind; id: string } | null = null;
      for (const k of ['attack', 'defense', 'meditation'] as DiceKind[]) {
        const d = o.areas[k].find((x) => x.id === dieId);
        if (d) {
          found = { kind: k, id: d.id };
          break;
        }
      }
      if (!found) throw new Error('雨落狂流：对方没有该能力骰');
      g.pending = null;
      consumeDice(g, o, found.kind, [found.id]);
      logLine(g, `${pname(pd.player)} 「雨落狂流」：弃置 ${pname(opp)} 的 1 个能力骰`);
      break;
    }
    case 'shouhunCancel': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'shouhunCancel') throw new Error('no shouhunCancel pending');
      const pa2 = pd.attack;
      g.pending = null;
      if (action.cancel) {
        const owner = g.players[pd.owner];
        const card = owner.artifacts.find((x) => x.skills.some((s) => (SHOUHUN_CONT_KEYS as readonly string[]).includes(s.key)));
        // 「兽魂」这张卡有**两面**（熊：攻击+X / 狼：速度+X），取消伤害的效果两面都写着 →
        // 只弹**当前激活那一面**的持续技能名（此前把 4 个 key 全发 → 同名卡的两个 key 都命中 → 弹两次，真实事故）。
        const cont = card?.skills.find(
          (s) =>
            (SHOUHUN_CONT_KEYS as readonly string[]).includes(s.key) &&
            s.kind === 'continuous' &&
            skillActive(card, s),
        );
        if (card && card.count > 0) card.count -= 1;
        logLine(
          g,
          `${pname(pd.player)} 「兽魂」：取消本次 ${pa2.value} 点伤害，令 ${pname(pd.owner)} 的「兽魂」计数下降 1 点${
            card ? `（${card.count}）` : ''
          }`,
        );
        // 取消的这次攻击仍**算作进行了一次攻击 / 使用了攻击骰**（说明书「取消」条）：
        // 触发"使用攻击骰后/进行攻击后"类；但 damageDealt=0 → "造成伤害后"类不触发；blocked=false → "被抵挡后"类不触发。
        // 关键：必须推进多段攻击队列（否则 013 电刑 / A01 不败之王 的第 2/3 段会凭空消失）。
        if (cont) fxSkillFired(g, pd.owner, cont.key);
        if ((g.phase as string) !== 'gameOver') {
          afterAttackResolved(g, pa2, { blocked: false, damageDealt: 0 });
          pumpAttackQueue(g);
        }
        break;
      }
      logLine(g, `${pname(pd.player)} 「兽魂」：不取消，正常造成伤害`);
      const before = g.players[pd.owner].life;
      applyLifeLoss(g, pd.owner, pa2.value);
      logLine(g, `${pname(pd.owner)} 未抵挡，受到 ${pa2.value} 点伤害（生命 ${before} → ${g.players[pd.owner].life}）`);
      if ((g.phase as string) !== 'gameOver') {
        afterAttackResolved(g, pa2, { blocked: false, damageDealt: pa2.value });
        pumpAttackQueue(g);
      }
      break;
    }
    case 'shipeiPick': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'shipeiPick') throw new Error('no shipeiPick pending');
      if (action.cancel) {
        g.pending = null;
        logLine(g, `${pname(pd.player)} 不发动「适应」`);
        break;
      }
      const dieId = action.dieId;
      const value = action.value;
      if (!dieId || !pd.dieIds.includes(dieId)) throw new Error('「适应」：请从本次掷出的骰中选择 1 颗');
      if (!Number.isInteger(value) || value! < 1 || value! > 6) throw new Error('「适应」：点数须在 1–6');
      const p = g.players[pd.player];
      const kinds: DiceKind[] = ['attack', 'defense', 'meditation'];
      if (!kinds.some((k) => p.areas[k].some((d) => d.id === dieId))) throw new Error(`「适应」：找不到该骰 ${dieId}`);
      g.pending = null;
      p.tacticOnceUsed = true;
      fxTacticFired(g, pd.player);
      if (pd.replaceByDist) {
        const dist = p.artifacts.find((a) => a.column === 2)?.distribution;
        if (!dist) throw new Error(`player ${pd.player} has no distribution`);
        for (const k of kinds) p.areas[k] = p.areas[k].filter((d) => d.id !== dieId);
        const kind = areaOf(value!, dist);
        p.areas[kind].push(createDie(dieId, value!, kind));
        const cn: Record<DiceKind, string> = { attack: '攻击', defense: '防御', meditation: '冥想' };
        logLine(g, `${pname(pd.player)} 「适应」：将 1 颗骰的点数改为 ${value}（移入${cn[kind]}骰区）`);
      } else {
        for (const k of kinds) {
          const d = p.areas[k].find((x) => x.id === dieId);
          if (d) {
            d.value = value!;
            break;
          }
        }
        logLine(g, `${pname(pd.player)} 「适应」：将 1 颗骰的点数改为 ${value}`);
      }
      break;
    }
    case 'youdiMove': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'youdiMove') throw new Error('no youdiMove pending');
      if (action.cancel) {
        g.pending = null;
        logLine(g, `${pname(pd.player)} 不发动「诱敌」`);
        break;
      }
      const p = g.players[pd.player];
      const from = action.from;
      const to = action.to;
      const ids = action.dieIds ?? [];
      if (!from || !to || from === to) throw new Error('「诱敌」需指定不同的来源/目标区域');
      if (ids.length < 1 || ids.length > 3) throw new Error('「诱敌」需移动 1–3 颗能力骰');
      if (new Set(ids).size !== ids.length) throw new Error('duplicate die id');
      const inFrom = new Set(p.areas[from].map((d) => d.id));
      for (const id of ids) if (!inFrom.has(id)) throw new Error(`not your die in ${from}: ${id}`);
      g.pending = null;
      p.tacticOnceUsed = true;
      // 走统一入口 `moveDice`（会发 `move` 旁路事件）——不再由界面"对比 DOM 自己猜"（AGENTS「别再猜，引擎报事件」）
      moveDice(g, pd.player, ids, to);
      const cn: Record<DiceKind, string> = { attack: '攻击', defense: '防御', meditation: '冥想' };
      logLine(g, `${pname(pd.player)} 「诱敌」：将${cn[from]}骰区的 ${ids.length} 颗骰移到${cn[to]}骰区（保留点数）`);
      fxTacticFired(g, pd.player);
      break;
    }
    case 'yingziPick': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'yingziPick') throw new Error('no yingziPick pending');
      if (!Number.isInteger(action.value) || action.value < 1 || action.value > 6) {
        throw new Error('「影子」点数须在 1–6');
      }
      g.pending = null;
      const p = g.players[pd.player];
      p.tacticHeldDie = { id: newDieId(`${pd.player}-`), value: action.value };
      logLine(g, `${pname(pd.player)} 「影子」：将 1 个 ${action.value} 点能力骰从供应堆置于战术上`);
      fxTacticFired(g, pd.player); // 动效旁路：置骰那一刻也弹「影子」气泡（战术栏）
      break;
    }
    case 'yuhuiPlace': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'yuhuiPlace') throw new Error('no yuhuiPlace pending');
      if (action.areas.length !== 2) throw new Error('「迂回」需为 2 颗骰各指定 1 个区域');
      for (const k of action.areas) {
        if (k !== 'attack' && k !== 'defense' && k !== 'meditation') throw new Error(`invalid area: ${k}`);
      }
      g.pending = null;
      const p = g.players[pd.player];
      const cn: Record<DiceKind, string> = { attack: '攻击', defense: '防御', meditation: '冥想' };
      for (const k of action.areas) p.areas[k].push(createDie(newDieId(`${pd.player}-`), 1, k));
      logLine(g, `${pname(pd.player)} 「迂回」：获得 2 个 1 点能力骰 → 放置于 ${action.areas.map((k) => cn[k]).join('、')}`);
      break;
    }
    case 'yuanjianGain': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'yuanjianGain') throw new Error('no yuanjianGain pending');
      if (!Number.isInteger(action.value) || action.value < 1 || action.value > 6) {
        throw new Error('「远见」点数须在 1–6');
      }
      if (action.area !== 'attack' && action.area !== 'defense' && action.area !== 'meditation') {
        throw new Error(`invalid area: ${action.area}`);
      }
      g.pending = null;
      const p = g.players[pd.player];
      const cn: Record<DiceKind, string> = { attack: '攻击', defense: '防御', meditation: '冥想' };
      p.areas[action.area].push(createDie(newDieId(`${pd.player}-`), action.value, action.area));
      logLine(
        g,
        `${pname(pd.player)} 「远见」：猜测正确 → 获得 1 个 ${action.value} 点能力骰 → ${cn[action.area]}骰区`,
      );
      break;
    }
    case 'ciBei': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'ciBei') throw new Error('no ciBei pending');
      g.pending = null;
      const payer = g.players[pd.player];
      if (action.accept) {
        payer.tacticOnceUsed = true;
        logLine(g, `${pname(pd.player)} 「慈悲」：取消该 ${pd.amount} 点伤害，改为回复 ${pd.amount} 点生命（整局 1 次）`);
        fxTacticFired(g, pd.player);
        heal(g, pd.player, pd.amount);
        // 攻击伤害：视为本次攻击未造成伤害（仍算进行过一次攻击；"被抵挡"事实按原结算）
        if (pd.attack && (g.phase as string) !== 'gameOver') {
          settleAttack(g, pd.attack, {
            blocked: pd.blocked ?? false,
            blockedForTriggers: pd.blockedForTriggers ?? false,
            damageDealt: 0,
            applyDamage: false,
          });
        }
        break;
      }
      // 不发动 → 照常结算
      if (pd.attack) {
        settleAttack(g, pd.attack, {
          blocked: pd.blocked ?? false,
          blockedForTriggers: pd.blockedForTriggers ?? false,
          damageDealt: pd.amount,
          applyDamage: true,
        });
      } else {
        dealTrueDamage(g, pd.target, pd.amount, pd.player, { skipCibei: true, skipLine: true }); // 原始技能发动时已飞过线，不再重复
      }
      break;
    }
    case 'chuxingPick': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'sijiChuxing') throw new Error('no sijiChuxing pending');
      const card = artifactWithSkill(g.players[pd.player], 'siji.chuxing');
      g.pending = null;
      if (action.pick === 'none') {
        logLine(g, `${pname(pd.player)} 不发动「处刑通牒」`);
        doAttack(g, pd.player, pd.costSlots);
        break;
      }
      if (!card || card.count < 1) throw new Error('no 「死契」 count to spend');
      card.count -= 1;
      const mods: AttackMods =
        action.pick === 'unblockable'
          ? { minBonus: 1, bonusLabel: '处刑通牒', forceUnblockable: true }
          : { minBonus: 5, bonusLabel: '处刑通牒' };
      logLine(
        g,
        `${pname(pd.player)} 发动「处刑通牒」：计数 −1（${card.count}），本次攻击${
          action.pick === 'unblockable' ? '伤害 +1 且不可抵挡' : '伤害 +5'
        }`,
      );
      doAttack(g, pd.player, pd.costSlots, mods);
      fxSkillFired(g, pd.player, 'siji.chuxing');
      // L08 传奇面板·只为赏金而来（触发）：**实际发动**「处刑通牒」（选①/②）之后 → 由持有者选择启动 1 个"已激活的启动式"技能
      // （放在 doAttack 之后：攻击已生成、正在等抵挡决定；本待决策会先弹出，符合"触发处刑通牒后立即"的时序）
      if (hasActiveSkill(g.players[pd.player], 'xiva.zhiweishangjin')) {
        queuePending(g, { kind: 'shangjin', player: pd.player });
      }
      break;
    }
    case 'weijuPay': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'weijuPay') throw new Error('no weijuPay pending');
      const p = g.players[pd.player];
      // 支付填法：显式 costSlots（010 置换 2 颗顶 1）优先；否则单颗 dieId
      const fills: SlotFill[] | null =
        action.costSlots && action.costSlots.length === 1
          ? action.costSlots
          : action.dieId
            ? [{ dieIds: [action.dieId] }]
            : null;
      if (!fills) throw new Error('weijuPay needs a die');
      const firstId = fills[0].dieIds[0];
      const info = abilityDieInfo(g, pd.player, firstId);
      if (!info) throw new Error(`not your ability die: ${firstId}`);
      const spec = fills[0].dieIds.length === 2 ? [{ kind: 'meditation' as DiceKind }] : [{ kind: info.kind }];
      // 「对方必须消耗 1 个任意能力骰」→ 走 paySlots（支持 010 置换 / 034 破障）
      const eff = paySlots(g, pd.player, spec, fills, undefined, 'skill');
      const theirValue = eff[0].value;
      g.pending = null;
      // 动效旁路：被要求方骰到位 → 与发起方停在中间的骰并排后一起消失
      fxPush({ kind: 'weiju', player: pd.player, mode: 'pay', dieIds: fills[0].dieIds, value: theirValue });
      const kindCn = info.kind === 'attack' ? '攻击' : info.kind === 'defense' ? '防御' : '冥想';
      logLine(
        g,
        `${pname(pd.player)} 因「畏惧」消耗 1 颗${kindCn}骰（${theirValue}点），与 ${pname(pd.initiator)} 的 ${pd.initiatorValue} 点比较`,
      );
      // FAQ 23.2.1：1 点视为大于 6 点
      const beats = (x: number, y: number): boolean => (x === 1 && y === 6 ? true : y === 1 && x === 6 ? false : x > y);
      if (beats(pd.initiatorValue, theirValue)) {
        p.attackHalvedNextTurn = true;
        logLine(g, `「畏惧」生效：${pname(pd.player)} 点数较小 → 其下个回合中攻击造成的伤害减半`);
      } else {
        logLine(g, `「畏惧」未生效（1 视为大于 6；相等或更大则无事发生）`);
      }
      break;
    }
    case 'challengeStep': {
      if (g.mode !== 'challenge') throw new Error('not challenge mode');
      if (g.activePlayer !== 'B') throw new Error('not legend turn');
      if (g.pending || g.pendingAttack || g.attackQueue || g.virtualQueue) throw new Error('legend turn busy');
      if (g.challenge?.resumeAt == null) throw new Error('no challenge step pending');
      continueLegendTurn(g, true);
      break;
    }
    case 'challengePick': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'challengePick') throw new Error('no challengePick pending');
      const opt = pd.options.find((o) => o.id === action.id);
      if (!opt) throw new Error(`非法代决选项：${action.id}`);
      g.pending = null;
      const card = CHALLENGES.find((c) => c.id === g.challenge?.cardId);
      // 选择归到"**正在结算的那条技能**"：不能用 resumeAt —— "延后一步"的代决（例：暗夜凶神弃骰）
      // 是在攻击结算后问的，那时 resumeAt 已经指向下一条了。
      const idx = g.challenge?.activeSkill ?? g.challenge?.resumeAt ?? 0;
      const key = card?.skills?.[idx]?.id ?? 'unknown';
      const dec = (g.challenge!.decisions ??= {});
      dec[key] = [...(dec[key] ?? []), action.id];
      logLine(g, `（代决）${pd.prompt} → ${opt.label}`);
      break;
    }
    case 'gongzhenResolve': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'gongzhenPick') throw new Error('no gongzhenPick pending');
      const me = pd.player;
      const opp: PlayerId = me === 'A' ? 'B' : 'A';
      g.pending = null;
      const kind = pd.areaKind;
      const kindCn = kind === 'attack' ? '攻击' : kind === 'defense' ? '防御' : '冥想';
      if (action.pick === 'gain') {
        // 单人挑战：传奇没有冥想骰区 → 跳过给它的冥想骰（FAQ 23.2.3）
        const skipLegend = g.mode === 'challenge' && opp === 'B' && kind === 'meditation';
        withRng(g, (rng) => {
          gainRandomDice(g, me, kind, 2, rng);
          if (!skipLegend) gainRandomDice(g, opp, kind, 2, rng);
        });
        logLine(
          g,
          skipLegend
            ? `「共振」：${pname(me)} 获得 2 个随机点数的${kindCn}骰（单人挑战：跳过「昔日传奇」的那份）`
            : `「共振」：${pname(me)} 与 ${pname(opp)} 各获得 2 个随机点数的${kindCn}骰`,
        );
        break;
      }
      // ② 双方各弃置最多 2 颗该类型（由发起者选择；不足则尽可能，FAQ 23.2.2）
      const pickFor = (who: PlayerId, ids: string[]): number => {
        const valid = ids.filter((id) => g.players[who].areas[kind].some((d) => d.id === id)).slice(0, 2);
        if (valid.length > 0) consumeDice(g, g.players[who], kind, valid);
        return valid.length;
      };
      const mine = pickFor(me, action.myIds ?? []);
      const theirs = pickFor(opp, action.oppIds ?? []);
      logLine(g, `「共振」：${pname(me)} 弃置自己 ${mine} 颗、${pname(opp)} 的 ${theirs} 颗${kindCn}骰`);
      break;
    }
    case 'weiyaPick': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'weiyaPick') throw new Error('no weiyaPick pending');
      if (!action.dieId) {
        g.pending = null;
        logLine(g, `${pname(pd.player)} 不发动「威压」`);
        break;
      }
      const target: PlayerId = action.owner === 'opp' ? (pd.player === 'A' ? 'B' : 'A') : pd.player;
      const old = setDieValue(g, target, action.dieId, pd.value);
      g.pending = null;
      logLine(
        g,
        `${pname(pd.player)} 发动「威压」：将 ${pname(target)} 的 1 颗能力骰 ${old} → ${pd.value}（保留原区域）`,
      );
      fxSkillFired(g, pd.player, 'aige.weiya');
      break;
    }
    case 'xianzhenResolve': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'xianzhenPick') throw new Error('no xianzhenPick pending');
      const found = findDieOf(g, pd.owner, action.dieId);
      if (!found) throw new Error(`not ${pd.owner} ability die: ${action.dieId}`);
      const ownerP = g.players[pd.owner];
      ownerP.areas[found.kind] = ownerP.areas[found.kind].filter((d) => d.id !== action.dieId);
      logLine(
        g,
        `「陷阵」：${pname(pd.player)} 选择弃置 ${pname(pd.owner)} 的 ${found.die.value} 点能力骰`,
      );
      fxSkillFired(g, pd.owner, 'aige.xianzhen');
      // 然后：持有者获得「另外两种类型」的随机点数能力骰各 1 个
      const others = KINDS_ORDER.filter((k) => k !== found.kind);
      withRng(g, (rng) => {
        const gained = others.flatMap((k) => gainRandomDice(g, pd.owner, k, 1, rng));
        logLine(
          g,
          `${pname(pd.owner)} 「陷阵」：获得另外两种类型的随机点数能力骰各 1 个（${gained
            .map((d) => d.value)
            .join('/')}）`,
        );
      });
      g.pending = null;
      break;
    }
    case 'hengguan': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'hengguan') throw new Error('no hengguan pending');
      if (!action.dieId) {
        g.pending = null;
        logLine(g, `${pname(pd.player)} 不发动「横贯」`);
        break;
      }
      const oppId: PlayerId = pd.player === 'A' ? 'B' : 'A';
      const found = findDieOf(g, oppId, action.dieId);
      if (!found) throw new Error(`not ${oppId} ability die: ${action.dieId}`);
      if (found.die.value >= pd.value) throw new Error('「横贯」只能弃置点数小于该攻击的能力骰');
      const oppP = g.players[oppId];
      oppP.areas[found.kind] = oppP.areas[found.kind].filter((d) => d.id !== action.dieId);
      g.pending = null;
      logLine(
        g,
        `${pname(pd.player)} 发动「横贯」：弃置 ${pname(oppId)} 的 ${found.die.value} 点能力骰（小于本次攻击 ${pd.value} 点）`,
      );
      fxSkillFired(g, pd.player, 'tuohu.hengguan.trigger');
      break;
    }
    case 'hanguangPick': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'hanguangPick') throw new Error('no hanguangPick pending');
      const card = artifactWithSkill(g.players[pd.player], 'hanguang.ultimate');
      if (!card || !card.heldDice) throw new Error('no 寒光·必杀 data');
      const held = card.heldDice.find((d) => d.id === action.dieId);
      if (!held) throw new Error(`held die not found: ${action.dieId}`);
      const oppId: PlayerId = pd.player === 'A' ? 'B' : 'A';
      const kindCnOf = (k: DiceKind): string => (k === 'attack' ? '攻击' : k === 'defense' ? '防御' : '冥想');
      if (action.pick === 'move') {
        const dist = g.players[pd.player].artifacts.find((a) => a.column === 2)?.distribution;
        if (!dist) throw new Error('no distribution');
        const kind = areaOf(held.value, dist);
        card.heldDice = card.heldDice.filter((d) => d.id !== action.dieId);
        g.players[pd.player].areas[kind].push({ id: held.id, value: held.value, kind });
        logLine(
          g,
          `${pname(pd.player)} 「凛冽之音」：将神器上的 ${held.value} 点骰移入${kindCnOf(kind)}骰区`,
        );
      } else {
        if (!action.targetDieId) throw new Error('missing target die');
        const found = findDieOf(g, oppId, action.targetDieId);
        if (!found) throw new Error(`not ${oppId} ability die: ${action.targetDieId}`);
        if (found.die.value !== held.value) {
          throw new Error('「凛冽之音」只能弃置与神器上该骰点数相同的对方能力骰');
        }
        g.players[oppId].areas[found.kind] = g.players[oppId].areas[found.kind].filter(
          (d) => d.id !== action.targetDieId,
        );
        card.heldDice = card.heldDice.filter((d) => d.id !== action.dieId);
        logLine(
          g,
          `${pname(pd.player)} 「凛冽之音」：移除神器上的 ${held.value} 点骰，弃置 ${pname(oppId)} 的 1 颗 ${held.value} 点能力骰`,
        );
      }
      // 动效旁路：027 寒光·必杀的两种模式（供界面播"移入对应区" / "与对方同点骰一起消失"）
      fxSkillFired(g, pd.player, 'hanguang.ultimate');
      fxPush({
        kind: 'hanguang',
        player: pd.player,
        mode: action.pick,
        heldId: action.dieId,
        ...(action.targetDieId ? { opponentId: action.targetDieId } : {}),
      });
      g.pending = null;
      // 继续本次攻击：先处理 022（若可用），否则直接发起攻击
      if (
        hasActiveSkill(g.players[pd.player], 'siji.chuxing') &&
        (artifactWithSkill(g.players[pd.player], 'siji.chuxing')?.count ?? 0) >= 1
      ) {
        g.pending = { kind: 'sijiChuxing', player: pd.player, costSlots: pd.costSlots };
      } else {
        doAttack(g, pd.player, pd.costSlots);
      }
      break;
    }
    case 'quanzhiAssign': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'quanzhiAssign') throw new Error('no quanzhiAssign pending');
      validateQuanzhiAssign(g, pd.player, action.assign);
      const p = g.players[pd.player];
      const all = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation];
      for (const d of all) {
        const k = action.assign[d.id];
        if (d.kind !== k) {
          p.areas[d.kind] = p.areas[d.kind].filter((x) => x.id !== d.id);
          d.kind = k;
          p.areas[k].push(d);
        }
      }
      logLine(
        g,
        `${pname(pd.player)} 「全知」：将全部能力骰重新落区（防御=同点成对 / 攻击=顺点三连 / 其余冥想）`,
      );
      // 动效旁路：本次重排的**全部**骰子（含"落区没变"的）→ 界面整体"聚中间再分体"
      fxPush({ kind: 'move', player: pd.player, dieIds: Object.keys(action.assign) });
      g.pending = null;
      break;
    }
    case 'kuyuResolve': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'kuyu') throw new Error('no kuyu pending');
      const area = action.area;
      if (area !== 'attack' && area !== 'defense' && area !== 'meditation') throw new Error('invalid area');
      g.pending = null;
      const kindCn = area === 'attack' ? '攻击' : area === 'defense' ? '防御' : '冥想';
      withRng(g, (rng) => {
        const gained = gainRandomDice(g, pd.player, area, 1, rng);
        const die = gained[0];
        const dist = emptyDistribution(g.players[pd.player]);
        const expected = dist ? areaOf(die.value, dist) : area;
        logLine(
          g,
          `${pname(pd.player)} 「低语」：宣称${kindCn}骰区，获得 1 个随机点数能力骰（${die.value} 点）并移入${kindCn}骰区`,
        );
        if (expected !== area) {
          const before = g.dustfall;
          incrementDustfall(g);
          logLine(g, `「低语」：该骰（${die.value} 点）不符合骰点分布，尘落 ${before} → ${g.dustfall}`);
        }
      });
      fxSkillFired(g, pd.player, 'mengyan.diyu');
      break;
    }
    case 'tiaolingResolve': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'tiaolingPick') throw new Error('no tiaolingPick pending');
      const p = g.players[pd.player];
      const ids = action.dieIds ?? [];
      if (new Set(ids).size !== ids.length) throw new Error('duplicate die id');
      const all = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation];
      const discardSet = new Set(ids);
      for (const id of ids) if (!all.some((d) => d.id === id)) throw new Error(`not your ability die: ${id}`);
      const remaining = all.filter((d) => !discardSet.has(d.id));
      const vals = remaining.map((d) => d.value);
      const ok = action.pick === 'same' ? new Set(vals).size <= 1 : new Set(vals).size === vals.length;
      if (!ok) {
        throw new Error(
          action.pick === 'same' ? '「死亡亦逝」：弃置后须全部点数相同' : '「死亡亦逝」：弃置后须全部点数不同',
        );
      }
      for (const id of ids) {
        const found = findDieOf(g, pd.player, id);
        if (found) consumeDice(g, p, found.kind, [id]);
      }
      g.pending = null;
      logLine(
        g,
        `${pname(pd.player)} 「死亡亦逝」：选择「${action.pick === 'same' ? '全部相同' : '全部不同'}」，弃置 ${ids.length} 颗能力骰`,
      );
      fxSkillFired(g, pd.player, 'diaoling.siwang');
      break;
    }
    case 'endDiscardResolve': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'endDiscard') throw new Error('no endDiscard pending');
      // 先校验（数量/归属）→ 失败抛错且不改状态；成功后才清 pending
      endPhase(g, pd.player, action.dieIds ?? []);
      g.pending = null;
      break;
    }
    case 'wanzhangDiscard': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'wanzhangDiscard') throw new Error('no wanzhangDiscard pending');
      const p = g.players[pd.player];
      const all = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation];
      const n = Math.min(2, all.length);
      const ids = action.dieIds ?? [];
      if (new Set(ids).size !== ids.length) throw new Error('duplicate die id');
      if (ids.length !== n) throw new Error(`「万丈明光」需弃置 ${n} 个能力骰`);
      for (const id of ids) {
        const found = findDieOf(g, pd.player, id);
        if (!found) throw new Error(`not your ability die: ${id}`);
        consumeDice(g, p, found.kind, [id]);
      }
      g.pending = null;
      logLine(g, `${pname(pd.player)} 「万丈明光」：主要阶段开始，弃置 ${ids.length} 个能力骰`);
      fxSkillFired(g, pd.player, 'qianjie.wanzhang');
      break;
    }
    case 'putiResolve': {
      const pd = g.pending;
      if (!pd || pd.kind !== 'putiPick') throw new Error('no putiPick pending');
      if (!pd.attack) throw new Error('putiPick missing attack');
      const pa = pd.attack;
      g.pending = null;
      if (!action.accept) {
        logLine(g, `${pname(pd.player)} 不发动「不动菩提」`);
        // mode='block'：防御骰站住 → 走正常"抵挡"；mode='attack'：攻击已停住 → 继续（此时才做 011 追问）
        if (pd.mode === 'block') finalizeAttackResolution(g, pa, true);
        else maybeBarrier(g, pa);
        break;
      }
      // 发动：移除神器上 1 个同点数存放骰
      const card = artifactWithSkill(g.players[pd.player], 'jingang.puti.trigger');
      const removedHeld = card?.heldDice?.find((h) => h.value === pd.value);
      if (card?.heldDice) card.heldDice = card.heldDice.filter((h) => h.value !== pd.value);
      const joinIds = removedHeld ? [removedHeld.id] : [];
      if (pd.mode === 'block') {
        logLine(g, `${pname(pd.player)} 「不动菩提」：移除 1 个 ${pd.value} 点存放骰，取消对方的抵挡`);
        // 动效：攻击+防御+灰存放骰 三颗并排 → 一起消失
        fxPush({ kind: 'attackJoin', player: pd.player, mode: 'cancel', dieIds: joinIds, value: pd.value });
        finalizeAttackResolution(g, pa, false);
      } else {
        logLine(g, `${pname(pd.player)} 「不动菩提」：移除 1 个 ${pd.value} 点存放骰，取消对方的攻击`);
        // 动效：攻击骰 + 灰存放骰 并排 → 一起消失
        g.pendingAttack = null;
        fxPush({ kind: 'attackJoin', player: pd.player, mode: 'cancel', dieIds: joinIds, value: pd.value });
        pumpAttackQueue(g);
      }
      fxSkillFired(g, pd.player, 'jingang.puti.trigger');
      break;
    }
    case 'skill': {
      const pendingSkill = g.pending && g.pending.kind === 'activationResolve' ? g.pending : null;
      const resolvingActivation =
        pendingSkill !== null && pendingSkill.artifactId === action.artifactId && pendingSkill.side === action.side;
      const pendingCharge = g.pending && g.pending.kind === 'chargeResolve' ? g.pending : null;
      const resolvingCharge = pendingCharge !== null && pendingCharge.artifactId === action.artifactId;
      if (g.phase !== 'main' && !resolvingActivation && !resolvingCharge) throw new Error('not main phase');
      // L08「只为赏金而来」：赏金给的这次启动发生在"攻击已生成、正等抵挡决定"之间（卡面「立即」）→ 放行
      const pendingShangjin = g.pending && g.pending.kind === 'shangjin' ? g.pending : null;
      if (g.pendingAttack && !pendingShangjin) throw new Error('pending attack unresolved');
      // 技能持有者（= 行动者）：强制结算的待决策可能属于**非当前回合玩家**（如 L05「复仇之灵」在对方回合强制尘起后
      // 触发 014「惩戒」的「激活」选择器）→ 一律取待决策的玩家，绝不能用 activePlayer（否则 `no artifact` 抛错）
      const skillOwner: PlayerId = pendingSkill?.player ?? pendingCharge?.player ?? pendingShangjin?.player ?? g.activePlayer;
      const p = g.players[skillOwner];
      // 技能持有者：优先神器；否则若 id 命中该玩家的传奇面板 → 用适配器（面板技能开局即可用）
      const a =
        p.artifacts.find((x) => x.id === action.artifactId) ??
        (p.legend && p.legend.id === action.artifactId ? legendAsArtifact(p.legend) : undefined);
      if (!a) throw new Error(`no artifact: ${action.artifactId}`);
      // 技能使用者 = 神器持有者（须在处理器的 endMainPhase 改变 activePlayer **之前**捕获）
      const skillUser = skillOwner;
      // 传奇面板动作带 `legendKey` → 按 key 精确取（面板可同时含「启动 / 必杀」）
      const legendKey = (action.params?.legendKey as string | undefined) ?? undefined;
      const s = legendKey
        ? a.skills.find(
            (x) => x.key === legendKey && (x.kind === 'activate' || x.kind === 'ultimate'),
          )
        : a.skills.find(
            (x) =>
              x.side === action.side &&
              (x.kind === 'activate' ||
                x.kind === 'activation' ||
                x.kind === 'ultimate' ||
                (resolvingCharge && x.kind === 'charge')),
          );
      if (!s) throw new Error('no usable skill on that side');
      if (s.kind === 'charge') {
        // 024：充能技能由「充能行动」触发的强制选择结算，不能手动发动
        if (!resolvingCharge) throw new Error('充能技能由充能行动结算，不能手动发动');
      } else if (!skillActive(a, s)) {
        // L08 没有怜悯：024 的必杀在"没有怜悯"生效期间**无需激活/充能**（其余技能不变）
        const lianminUlt = s.key === 'kuangwu.ultimate' && hasActiveSkill(g.players[skillOwner], 'xiva.meiyoulianmin') && g.dustfall >= 4;
        if (!lianminUlt) throw new Error('skill not active');
      }
      if (s.kind === 'activation') {
        // 「激活」类只能由尘起装填时的强制结算触发，不能手动发动
        if (!resolvingActivation) throw new Error('激活类技能由尘起装填时立即强制结算，不能手动发动');
        if (!activationUsable(g, a, s)) throw new Error('activation skill only usable in the turn it was armed');
      }
      if (s.key === 'kuangwu.ultimate' && hasActiveSkill(g.players[skillOwner], 'xiva.meiyoulianmin') && g.dustfall >= 4) {
        // 没有怜悯：不吃"整局一次"（改为每回合 1 次，走下方 skillPerTurnLimit）
      } else if (s.kind === 'ultimate' && g.ultimatesUsed.includes(skillUseKey(skillUser, s.key))) {
        throw new Error('ultimate already used');
      }
      // L08 只为赏金而来：这次启动**不计入**每回合上限（也不写 skillsUsedThisTurn）
      const fromShangjin = pendingShangjin !== null && pendingShangjin.player === skillOwner;
      if (fromShangjin && s.kind !== 'activate') throw new Error('「只为赏金而来」只能启动"启动式"技能');
      if (
        !fromShangjin &&
        g.skillsUsedThisTurn.filter((k) => k === skillUseKey(skillUser, s.key)).length >=
          skillPerTurnLimit(g.players[skillUser], s.key)
      )
        throw new Error('skill already used this turn');
      assertConversionAllowed(g, skillOwner, action.params?.costSlots as SlotFill[] | undefined);
      const handler = SKILL_HANDLERS[s.key];
      if (!handler) throw new Error(`no handler for skill: ${s.key}`);
      g.skillConsumedThisAction = 0;
      // 动效旁路：记录"当前正在结算的发动卡"（真伤白墨线锚点 = 该技能卡图）
      fxSetSource({ player: skillOwner, artifactId: a.id, side: s.side, skillKey: s.key });
      // 登记"本次使用"（每回合一次 / 必杀整局一次）。抽成函数是为了让 L11「永恒女王」中途打断时也能登记：
      // 若 handler 内造成致死真伤触发永恒女王 → 抛 YonghengQueenSignal 立即展开结算栈，**必杀也必须记为"已用"**
      // （否则 L12「立地成佛」等打死永恒女王持有者后可再次发动——真实事故）。
      const recordUse = (): void => {
        if (s.key === 'tata.mengjing' || fromShangjin) return; // L04 重开已重置记录；赏金启动不占每回合上限
        g.skillsUsedThisTurn.push(skillUseKey(skillUser, s.key));
        const lianminUltRec =
          s.key === 'kuangwu.ultimate' && hasActiveSkill(g.players[skillOwner], 'xiva.meiyoulianmin') && g.dustfall >= 4;
        if (s.kind === 'ultimate' && !lianminUltRec) g.ultimatesUsed.push(skillUseKey(skillUser, s.key));
      };
      try {
        withRng(g, (rng) =>
          handler.run({
            g,
            player: skillOwner,
            artifact: a,
            rng,
            params: action.params ?? {},
            endMainPhase: () => endMainPhase(g),
            reportConsumed: (n) => {
              g.skillConsumedThisAction += n;
            },
          }),
        );
      } catch (e) {
        if (e instanceof YonghengQueenSignal) recordUse(); // 必杀照样算"已用尽"
        throw e; // 普通非法参数错误不登记；信号交给外层 runYonghengQueen
      }
      // L08「没有怜悯」：024 必杀**经它**发动 → **先**弹「没有怜悯」（随后才是 024 必杀的必杀横幅）
      if (s.key === 'kuangwu.ultimate' && hasActiveSkill(g.players[skillOwner], 'xiva.meiyoulianmin') && g.dustfall >= 4) {
        fxSkillFired(g, skillOwner, 'xiva.meiyoulianmin');
      }
      // L01「断苇一斩」：斩神切**经它**发动（改为弃置对方全部能力骰）→ 先弹「断苇一斩」（随后才是斩神切的必杀横幅）
      if (
        s.key === 'mingjing.ultimate' &&
        (action.params as { opponentDiscardAll?: boolean } | undefined)?.opponentDiscardAll === true
      ) {
        fxSkillFired(g, skillOwner, 'kong.duanweiyizhan');
      }
      // L08「只为赏金而来」：本次启动**由它授予**（不计每回合上限）→ 先弹「只为赏金而来」（随后才是被启动的技能名）
      if (fromShangjin) {
        fxSkillFired(g, skillOwner, 'xiva.zhiweishangjin');
      }
      // 动效旁路：技能"用"气泡（发动）。激活/充能会连弹两条（先「激活/充能」，再此条技能名）。
      fxPush({ kind: 'skillFired', player: skillOwner, artifactId: a.id, side: s.side, skillKey: s.key, auto: false });
      // 非法参数在处理器内抛错时不清空待决策（非法动作不得改变状态）
      // 只在"待决策仍是本次解决的那个"时清空 —— 处理器可能已经**设置了一个新的待决策**
      //（如 023 畏惧 → weijuPay），不能把它一起清掉
      const consumedPending = pendingSkill ?? pendingCharge ?? pendingShangjin;
      if (consumedPending && g.pending === consumedPending) g.pending = null;
      recordUse();
      // L02「残影」：影袭上限提到 2 → 第 2 次＝它多给的那次 → 弹「残影」
      if (
        s.key === 'yingle.yingxi' &&
        g.skillsUsedThisTurn.filter((k) => k === skillUseKey(skillUser, 'yingle.yingxi')).length >= 2
      ) {
        fxSkillFired(g, skillUser, 'ying.canying');
      }
      // L08 没有怜悯（持续）：每次启动「凶弹业舞」（必杀）后 → 你受到 2 点真实伤害
      if (
        s.key === 'kuangwu.ultimate' &&
        hasActiveSkill(g.players[skillOwner], 'xiva.meiyoulianmin') &&
        g.dustfall >= 4 &&
        (g.phase as string) !== 'gameOver'
      ) {
        logLine(g, `${pname(skillOwner)} 「没有怜悯」：启动「凶弹业舞」 → 受到 2 点真实伤害`);
        dealTrueDamage(g, skillOwner, 2, skillOwner); // 自伤：source=自己
      }
      // 战术牌 T04「末路」（触发）：启动**必杀式**后 → 造成/回复＝第三列神器充能需求
      // （覆盖：普通启动 / L08 没有怜悯 / L04 重开；018 强制必杀在 pending.ts 里另调）
      if (s.kind === 'ultimate') applyMolu(g, skillUser);
      // 019 蛮王之牙等：启动后刷新自身「每回合一次」计数（本回合可再次启动）
      if (s.refresh) g.skillsUsedThisTurn = g.skillsUsedThisTurn.filter((k) => k !== skillUseKey(skillUser, s.key));
      // 011 灵能脉冲·触发：通过技能消耗能力骰后，可额外造成等同消耗数量的真实伤害（每回合最多 1 次）
      if (
        g.skillConsumedThisAction > 0 &&
        hasActiveSkill(g.players[skillOwner], 'dunwu.pulse.trigger') &&
        !g.dunwuPulseUsedThisTurn &&
        g.pending === null
      ) {
        g.pending = { kind: 'dunwuPulse', player: skillOwner, amount: g.skillConsumedThisAction };
      }
      break;
    }
  }
  // 028 天罚（激活·本回合）：通过攻击造成 2 次伤害后，立即结束主要阶段
  const tf = g.tianfa[g.activePlayer];
  if (tf && tf.damageCount >= 2 && g.phase === 'main' && !g.pendingAttack && g.pending === null) {
    logLine(g, `${pname(g.activePlayer)} 「天罚」：本回合已通过攻击造成 2 次伤害，立即结束主要阶段`);
    endMainPhase(g);
  }
  // 每次动作结束后，把排队中的待决策/018 强制必杀弹出来（先于多段攻击的下一段）
  pumpPending(g);
  // 多段攻击（013 电刑等）被待决策打断后，解决该待决策应**自动继续下一段**（否则会停在半途，
  // 表现为"电刑后续各段不再触发任何'造成伤害后'类技能"）。
  pumpAttackQueue(g);
  // 挑战模式：传奇回合**不再在此自动续跑**——改由界面按节奏派发 `challengeStep` 逐条推进
  // （这样每条技能都"看得见"；代决/待抵挡结束后同样由界面继续下一步）。
  // 若已进入「结束」阶段且无待决策 → 真正结算结束阶段并交出回合（供 032/033 的待决策解决后推进）
  finalizeTurnEnd(g);
  // 战术牌·战前：抽牌完、无待决策 → 结算生命修正并进入初始重掷
  maybeEnterInitialReroll(g);
  // 战术牌 T07「保守」：每次行动结算后，若某持牌者防御骰第一次为 0 → 触发
  checkBaoshou(g);
  // 「没得做就自动翻页」：重掷 / 尘起 / 初始重掷阶段若确实没有任何可做之事 → 自动推进到下一阶段。
  // 必须排在 `checkBaoshou` 之后（T07 可能刚补了防御/冥想骰，不能把"刚有骰子可做"的阶段误判为空）。
  for (let guard = 0; guard < 6; guard++) {
    if (!autoAdvanceAction(g)) break;
    doAdvance(g);
  }
  // 自动推进可能新排队待决策（如 035「万丈明光」主要阶段开始的弃骰）→ 再泵一次（`pumpPending` 幂等）
  pumpPending(g);
  return g;
}
