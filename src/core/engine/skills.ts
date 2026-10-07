import { areaOf, createDie, newDieId } from '../model/dice';
import type { Rng } from '../rng/rng';
import type { Artifact, DiceKind, Die, GameState, PlayerId, PlayerState } from '../model/types';
import { skillActive, hasActiveSkill, skillUseKey } from './skill-state';
import { checkLifeEnd, dealTrueDamage, pumpAttackQueue, virtualAttack } from './combat';
import { abilityDieInfo, canPayCosts, checkLifeTens, findDieOf, gainRandomAbilityDice, gainRandomDice, heal, moveDice, noteLifeDrop, noteYuluoDiceConsumed, offerAdapt, paySlots, setDieValue, transferDice, xuyuYouhunTrigger, type SlotFill, type SlotSpec } from './effects';
import { doReroll } from './phases';
import { fxPush, fxSkillFired, fxSetSource, fxTrueLine } from './fx';
import { pumpPending, queuePending } from './pending';
import { resetToBattleStart } from './reset';
import { effectiveWill, emptyDistribution, totalDice } from './derive';
import { logLine, pname, vals } from './log';
export { skillActive, hasActiveSkill };

const KINDS: DiceKind[] = ['attack', 'defense', 'meditation'];

/**
 * L12「知我心者立地成佛」：**双方 6 区中"有骰且仅有 1 种点数"的区域**（空区域不算、含多种点数不算）。
 * **引擎与界面共用同一来源**（界面用它做"发动前预览：会造成几点伤害"，避免另抄一份规则）。
 */
export function lidichengfoRegions(
  g: GameState,
): { who: PlayerId; kind: DiceKind; ids: string[] }[] {
  const regions: { who: PlayerId; kind: DiceKind; ids: string[] }[] = [];
  for (const who of ['A', 'B'] as PlayerId[]) {
    for (const k of KINDS) {
      const arr = g.players[who].areas[k];
      if (arr.length === 0) continue;
      if (new Set(arr.map((d) => d.value)).size !== 1) continue;
      regions.push({ who, kind: k, ids: arr.map((d) => d.id) });
    }
  }
  return regions;
}

/**
 * 014 净化 / 数罪并罚 共用效果：
 * 把 `owner` 的最多 2 个「1 点」能力骰变更为 6 点，并按 `owner` 第二列神器的分布移到对应区域；
 * 若至少变更 1 个：技能使用者 `self` 获得 2 个随机冥想骰，然后受到 2 点真实伤害。
 * 返回实际变更数量（可为 0）。
 */
export function changeOnePointDice(
  g: GameState,
  owner: PlayerId,
  ids: string[],
  self: PlayerId,
  rng: { rollDie(): number },
): number {
  if (ids.length > 2) throw new Error('at most 2 dice can be changed');
  if (new Set(ids).size !== ids.length) throw new Error('duplicate die id');
  const p = g.players[owner];
  const dist = emptyDistribution(p);
  if (!dist) throw new Error(`player ${owner} has no distribution`);
  for (const id of ids) {
    const die = KINDS.flatMap((k) => p.areas[k]).find((d) => d.id === id);
    if (!die) throw new Error(`not ${owner}'s die: ${id}`);
    if (die.value !== 1) throw new Error('only 1-point dice can be changed');
  }
  for (const id of ids) {
    setDieValue(g, owner, id, 6);
    moveDice(g, owner, [id], areaOf(6, dist));
  }
  const changed = ids.length;
  if (changed >= 1) {
    const gained = gainRandomDice(g, self, 'meditation', 2, rng);
    logLine(
      g,
      `${pname(self)} 获得 2 个随机点数的冥想骰（${vals(gained)}），随后受到 2 点真实伤害`,
    );
    dealTrueDamage(g, self, 2, self);
  }
  return changed;
}

export interface SkillCtx {
  g: GameState;
  player: PlayerId;
  artifact: Artifact;
  rng: Rng;
  params: Record<string, unknown>;
  /** 立即结束当前主要阶段（009 必杀等使用），由 game.ts 提供 */
  endMainPhase: () => void;
  /** 汇报本次技能「以消耗自身能力骰为代价」的骰子数量（011 灵能脉冲·触发用） */
  reportConsumed: (n: number) => void;
}

export interface SkillHandler {
  run(ctx: SkillCtx): void;
}

/** 从玩家的某区域移除指定骰（校验归属），返还供应堆。
 *  kind 为防御/冥想时触发 A06 异相·「幽魂不散」（技能效果"弃置"）。
 *  「雨落狂流」口径 (B)：**不看是谁执行的弃置**——只要该玩家的骰被弃置且不符合其分布即计数。 */
export function consumeDice(g: GameState, p: PlayerState, kind: DiceKind, ids: string[]): void {
  const area = p.areas[kind];
  const removed: { kind: DiceKind; value: number }[] = [];
  for (const id of ids) {
    const idx = area.findIndex((d) => d.id === id);
    if (idx < 0) throw new Error(`not a ${kind} die: ${id}`);
    removed.push({ kind, value: area[idx].value });
    area.splice(idx, 1);
  }
  noteYuluoDiceConsumed(g, p.id, removed);
  if (kind === 'defense' || kind === 'meditation') xuyuYouhunTrigger(g, p.id, ids.length);
}

/**
 * **批量弃置（多类型）**：一次技能效果（或一次动作）同时弃置攻/防/冥骰时用。
 * 与逐类型调用 `consumeDice` 的区别：**「雨落狂流」只 +1**
 * ——卡面为"弃置**任意数量**不符合骰点分布的能力骰后，计数 +1"，与骰数、类型数都无关
 * （曾因按类型各调一次 `consumeDice`，导致 003 斩神切 / 009 高塔铁幕 / 007 战争横扫 一次效果 +2~+3）。
 * `xuyuYouhunTrigger`（A06 幽魂不散）仍按类型/数量分别触发。
 */
export function consumeDiceByKind(
  g: GameState,
  p: PlayerState,
  byKind: Partial<Record<DiceKind, string[]>>,
): void {
  const removed: { kind: DiceKind; value: number }[] = [];
  const counts: Partial<Record<DiceKind, number>> = {};
  for (const kind of ['attack', 'defense', 'meditation'] as DiceKind[]) {
    const ids = byKind[kind] ?? [];
    if (ids.length === 0) continue;
    const area = p.areas[kind];
    for (const id of ids) {
      const idx = area.findIndex((d) => d.id === id);
      if (idx < 0) throw new Error(`not a ${kind} die: ${id}`);
      removed.push({ kind, value: area[idx].value });
      area.splice(idx, 1);
    }
    counts[kind] = ids.length;
  }
  if (removed.length === 0) return;
  noteYuluoDiceConsumed(g, p.id, removed); // ← 一次效果只一次
  if (counts.defense) xuyuYouhunTrigger(g, p.id, counts.defense);
  if (counts.meditation) xuyuYouhunTrigger(g, p.id, counts.meditation);
}

/**
 * 回合开始时的触发式持续效果（在重置回合标记之后、补充能力骰之前调用）。
 * FAQ 8.1.1：008「战车」在此时间点检查防御骰，获得的攻击骰计入能力骰总数，
 * 因此可能减少随后的正常补充数量。
 */
export function applyTurnStartEffects(g: GameState, player: PlayerId): void {
  // 008 战车：回合开始时若拥有 >=1 防御骰，获得 1 个 5 点攻击骰
  if (hasActiveSkill(g.players[player], 'tiebi.chariot') && g.players[player].areas.defense.length >= 1) {
    g.players[player].areas.attack.push({ id: newDieId(`${player}-`), value: 5, kind: 'attack' });
    logLine(g, `${pname(player)} 「战车」：回合开始，获得 1 个 5 点攻击骰`);
    fxSkillFired(g, player, 'tiebi.chariot');
  }
}

/** 034 金刚·激活（破障 / 不动菩提同效）：清空神器上的骰 → 放入 `count` 个骰（不入区域）
 *  - 034 原版：3 个**互不相同**的点数
 *  - A03 异相：2 个**任意**点数（可相同，由玩家决定，FAQ 39.1.3） */
function loadJingangDice(
  g: GameState,
  player: PlayerId,
  artifact: Artifact,
  params: Record<string, unknown>,
  count = 3,
  distinct = true,
): void {
  const pips = (params.pips as number[] | undefined) ?? [];
  const ok =
    pips.length === count &&
    (!distinct || new Set(pips).size === count) &&
    pips.every((v) => Number.isInteger(v) && v >= 1 && v <= 6);
  if (!ok) {
    throw new Error(
      distinct
        ? `「金刚」需选择 ${count} 个互不相同的点数（1–6）`
        : `「金刚」需选择 ${count} 个点数（1–6，可重复）`,
    );
  }
  // id 带玩家前缀：避免双方各持同型神器（如都拿 034/A03）时存放骰 id 跨玩家撞串
  artifact.heldDice = pips.map((v) => ({ id: `${player}-${artifact.id}-j${v}-${g.turnIndex}`, value: v }));
  logLine(
    g,
    `${pname(player)} 「${artifact.name}」激活：移除原有存放骰，放入 ${count} 个${
      distinct ? '点数互不相同' : '任意点数'
    }的骰（${pips.join('/')}）`,
  );
}

/** 020 兽魂 / A04 异相·「激活」：将本神器的计数重设为 2（shared） */
function resetShouhunCount(g: GameState, player: PlayerId, artifact: Artifact, name: string): void {
  artifact.count = 2;
  logLine(g, `${pname(player)} 「${name}」：激活 → 将本神器的计数重设为 ${artifact.count}`);
  // L07 传奇面板·始祖兽魂（触发）：**当你激活「兽魂」时**，可选**额外消耗 1 个冥想骰**，改为把计数重设为 3
  if (
    hasActiveSkill(g.players[player], 'nisa.shizushouhun') &&
    canPayCosts(g, player, { meditation: 1 }, { held: true })
  ) {
    queuePending(g, { kind: 'shizushouhun', player, artifactId: artifact.id });
  }
}

/** L03 拔城（触发）：启动「主宰」技能后，若"对方**实际弃置**的能力骰数 < 你**消耗**的能力骰数" → 由持有者决定是否发动 */
function bachengHook(g: GameState, player: PlayerId, consumed: number, oppDiscarded: number): void {
  const p = g.players[player];
  if (!hasActiveSkill(p, 'batton.bacheng')) return;
  if (oppDiscarded >= consumed) return;
  queuePending(g, { kind: 'bacheng', player });
}

export const SKILL_HANDLERS: Record<string, SkillHandler> = {
  // ── 传奇英雄面板技能（开局即可用、无需激活；`side` 恒为 'only'）──
  // L02 潸然的葬敌花（必杀·尘落前置 1）：双方各自获得 3 个随机点数的能力骰
  'ying.zangdihua': {
    run({ g, player, rng }) {
      const opp: PlayerId = player === 'A' ? 'B' : 'A';
      const mine = gainRandomAbilityDice(g, player, 3, rng);
      const theirs = gainRandomAbilityDice(g, opp, 3, rng);
      logLine(
        g,
        `${pname(player)} 发动必杀「潸然的葬敌花」：双方各自获得 3 个随机点数的能力骰（${pname(
          player,
        )} ${mine.map((d) => d.value).join('/')}；${pname(opp)} ${theirs.map((d) => d.value).join('/')}）`,
      );
    },
  },
  // 淬炼：消耗 1 攻击骰 → 本神器计数 +1（上限 3）
  // L06 无光领域（启动）：受到 4 点真实伤害 → 选①攻击点数+1（最大6）/②-1（最小1），持续到下次启动
  'xiu.wuguanglingyu': {
    run({ g, player, params }) {
      const p = g.players[player];
      const choice: 'up' | 'down' = params.choice === 'down' ? 'down' : 'up';
      logLine(g, `${pname(player)} 启动「无光领域」：受到 4 点真实伤害`);
      dealTrueDamage(g, player, 4, player);
      if ((g.phase as string) === 'gameOver') return;
      p.wuguang = choice;
      logLine(
        g,
        `「无光领域」：直到下次启动前，你的攻击点数视为${choice === 'up' ? '上升 1（最大 6）' : '下降 1（最小 1）'}`,
      );
    },
  },
  // L05 绝地惊雷（必杀·尘落前置 3）：受到 = |双方生命差| 的真实伤害（自伤）→ 获得 1 个 6 点攻击骰
  'zoray.juedi': {
    run({ g, player }) {
      const opp: PlayerId = player === 'A' ? 'B' : 'A';
      const diff = Math.abs(g.players[player].life - g.players[opp].life);
      logLine(
        g,
        `${pname(player)} 发动必杀「绝地惊雷」：受到 ${diff} 点真实伤害（＝双方生命差），获得 1 个 6 点攻击骰`,
      );
      if (diff > 0) dealTrueDamage(g, player, diff, player); // 自伤：source=自己（009 铁幕不触发）
      if ((g.phase as string) === 'gameOver') return;
      g.players[player].areas.attack.push({ id: newDieId(`${player}-`), value: 6, kind: 'attack' });
    },
  },
  // L04 我将在下个梦境与你再度相逢（必杀·尘落前置 0）：继承生命/尘落/技能计数，重置其余状态并重开一局，失去本技能
  'tata.mengjing': {
    run({ g, player, params }) {
      const first: PlayerId = params.first === 'B' ? 'B' : 'A';
      const lifeA = g.players.A.life;
      const lifeB = g.players.B.life;
      const dustfall = g.dustfall;
      // 失去本技能
      const lg = g.players[player].legend;
      if (lg) lg.skills = lg.skills.filter((s) => s.key !== 'tata.mengjing');
      logLine(
        g,
        `${pname(player)} 发动必杀「我将在下个梦境与你再度相逢」：继承双方生命（${pname('A')} ${lifeA} / ${pname(
          'B',
        )} ${lifeB}）与尘落（${dustfall}）及各技能计数，重置其余状态、重开一局；先手＝${pname(first)}；并失去本技能`,
      );
      resetToBattleStart(g, first);
      // 动效旁路：整盘重置 → 界面走"全部旧骰→中间合成一个→新骰从中间冒出"的专用动画
      fxPush({ kind: 'reset' });
    },
  },
  // L07「不屈咆哮」（必杀·尘落前置 2）：弃置对方数量＝你的「决意」**当前计数**的能力骰（多类型→**一次效果**），
  // 然后把「决意」的计数重设为 1。能弃则必须弃（对方不足则尽可能）。
  'nisa.buqupaoxiao': {
    run({ g, player, params }) {
      const p = g.players[player];
      const opp: PlayerId = player === 'A' ? 'B' : 'A';
      const o = g.players[opp];
      const jueyi = p.artifacts.find((a) => a.skills.some((s) => s.key === 'jueyi.wildfire'));
      const n = jueyi?.count ?? 0;
      if (!jueyi || n < 1) throw new Error('「决意」计数为 0：不屈咆哮不可发动');
      const total = o.areas.attack.length + o.areas.defense.length + o.areas.meditation.length;
      const need = Math.min(n, total); // 能弃则必须弃；不足则尽可能
      const ids = (params.dieIds as string[] | undefined) ?? [];
      if (new Set(ids).size !== ids.length) throw new Error('duplicate die id');
      if (ids.length !== need) throw new Error(`需弃置 ${need} 颗对方能力骰`);
      const byKind: Partial<Record<DiceKind, string[]>> = {};
      for (const id of ids) {
        const found = findDieOf(g, opp, id);
        if (!found) throw new Error(`not an opponent ability die: ${id}`);
        (byKind[found.kind] ??= []).push(id);
      }
      consumeDiceByKind(g, o, byKind); // 多类型一次效果 → 对方「雨落狂流」只 +1
      jueyi.count = 1;
      logLine(
        g,
        `${pname(player)} 发动必杀「不屈咆哮」：弃置 ${pname(opp)} 的 ${need} 颗能力骰（＝「决意」计数 ${n}${
          total < n ? '，对方能力骰不足故全弃' : ''
        }），并将「决意」的计数重设为 1`,
      );
    },
  },
  // L09「遍野残杀」（必杀·尘落前置 2）：你的所有神器的左右两侧技能全部视为处于激活状态；你的回合结束时你立即死亡
  'lifeng.bianyecansha': {
    run({ g, player }) {
      const p = g.players[player];
      for (const a of p.artifacts) a.allSidesActiveThisTurn = true;
      logLine(
        g,
        `${pname(player)} 发动必杀「遍野残杀」：本回合其所有神器的**左右两侧技能全部视为处于激活状态**；其回合结束时将立即死亡`,
      );
    },
  },
  'buxiang.cuilian': {
    run({ player, artifact, params, g, reportConsumed }) {
      const effective = paySlots(
        g,
        player,
        [{ kind: 'attack' }],
        (params.costSlots as SlotFill[] | undefined) ?? [],
        reportConsumed,
      );
      const spot = effective[0]?.value ?? 0;
      const before = artifact.count;
      artifact.count = Math.min(3, artifact.count + 1);
      logLine(
        g,
        `${pname(player)} 发动「淬炼」：消耗 1 颗攻击骰（${spot}点），「不祥」计数 ${before} → ${artifact.count}`,
      );
    },
  },
  // 龙腾万丈：消耗 3 冥想骰 → 获得 4 随机能力骰；最大/最小各 1 入攻击区，其余 2 入防御区；本回合攻击伤害 +1
  'youlong.tengwan': {
    run({ player, rng, params, g, reportConsumed }) {
      const p = g.players[player];
      const effective = paySlots(
        g,
        player,
        [{ kind: 'meditation' }, { kind: 'meditation' }, { kind: 'meditation' }],
        (params.costSlots as SlotFill[] | undefined) ?? [],
        reportConsumed,
      );
      const dice: Die[] = Array.from({ length: 4 }, () => createDie(newDieId(`${player}-`), rng.rollDie()));
      const sorted = [...dice].sort((a, b) => a.value - b.value);
      const min = sorted[0];
      const max = sorted[sorted.length - 1];
      for (const d of dice) {
        if (d === min || d === max) {
          d.kind = 'attack';
          p.areas.attack.push(d);
        } else {
          d.kind = 'defense';
          p.areas.defense.push(d);
        }
      }
      // T18「适应」：本次掷出的 4 颗随机骰可择 1 颗改点（落区方式为"最大/最小"自定义 → replaceByDist=false，只改点不重落）
      offerAdapt(g, player, dice, false);
      p.buffs.push({ attr: 'attackDamage', add: 1, duration: 'thisTurn', source: '龙腾万丈' });
      logLine(
        g,
        `${pname(player)} 发动「龙腾万丈」：消耗 3 颗冥想骰（${vals(effective)}），获得 4 颗能力骰（${vals(
          dice,
        )}），2 颗移入攻击骰区、2 颗移入防御骰区，本回合攻击伤害 +1`,
      );
    },
  },
  // 潜行：消耗 2 攻击骰 → 先获得 2 随机防御骰，再获得 1 随机冥想骰（顺序强制）
  'yingle.qianxing': {
    run({ player, rng, params, g, reportConsumed }) {
      const effective = paySlots(
        g,
        player,
        [{ kind: 'attack' }, { kind: 'attack' }],
        (params.costSlots as SlotFill[] | undefined) ?? [],
        reportConsumed,
      );
      const def = gainRandomDice(g, player, 'defense', 2, rng);
      const med = gainRandomDice(g, player, 'meditation', 1, rng);
      logLine(
        g,
        `${pname(player)} 发动「潜行」：消耗 2 颗攻击骰（${vals(effective)}），获得 2 颗防御骰（${vals(
          def,
        )}）与 1 颗冥想骰（${med[0].value}点）`,
      );
    },
  },
  // 明镜·充能：立即再次进行 1 次需要正常使用冥想骰的额外尘起行动（不占每回合 1 次上限）
  'mingjing.charge': {
    run({ g, player }) {
      g.freeDustRise += 1;
      logLine(g, `${pname(player)} 「明镜」充能效果：获得 1 次额外尘起行动`);
    },
  },
  // 完杀·充能：获得 1 个点数等于当前充能层数的攻击骰
  'wansha.charge': {
    run({ g, player, artifact }) {
      g.players[player].areas.attack.push(createDie(newDieId(`${player}-`), artifact.chargeLayer, 'attack'));
      logLine(g, `${pname(player)} 「完杀」充能效果：获得 1 颗 ${artifact.chargeLayer} 点攻击骰`);
    },
  },
  // 中央突破：消耗最多 3 个冥想骰 → 弃置对方等量防御骰；恰好 3 个则本回合攻击不可抵挡
  'yuqie.breakthrough': {
    run({ g, player, params, reportConsumed }) {
      const fills = (params.costSlots as SlotFill[] | undefined) ?? [];
      if (fills.length < 1 || fills.length > 3) throw new Error('costSlots must contain 1..3 slots');
      const spec: SlotSpec[] = Array.from({ length: fills.length }, () => ({ kind: 'meditation' as const }));
      const effective = paySlots(g, player, spec, fills, reportConsumed);
      const count = effective.length;
      const opponent: PlayerId = player === 'A' ? 'B' : 'A';
      const oppDef = g.players[opponent].areas.defense;
      const required = Math.min(count, oppDef.length);
      const defIds = (params.opponentDefenseDieIds as string[] | undefined) ?? [];
      if (new Set(defIds).size !== defIds.length) throw new Error('duplicate defense die id');
      for (const id of defIds) {
        if (!oppDef.some((d) => d.id === id)) throw new Error(`not an opponent defense die: ${id}`);
      }
      if (defIds.length !== required) throw new Error(`must discard exactly ${required} defense dice`);
      const def = defIds
        .map((id) => oppDef.find((d) => d.id === id))
        .filter((d): d is Die => d !== undefined);
      consumeDice(g, g.players[opponent], 'defense', defIds);
      if (count === 3) g.unblockableThisTurn = true;
      logLine(
        g,
        `${pname(player)} 发动「中央突破」：消耗 ${count} 颗冥想骰（${vals(effective)}），弃置 ${pname(
          opponent,
        )} 的 ${defIds.length} 颗防御骰（${vals(def)}）${
          count === 3 ? '，本回合攻击不可抵挡' : ''
        }`,
      );
    },
  },
  // C01 特典·突破（启动）：消耗**任意数量**冥想骰 → 弃置对方等量防御骰（发起者选；无"不可抵挡"）
  'c01.breakthrough': {
    run({ g, player, params, reportConsumed }) {
      const fills = (params.costSlots as SlotFill[] | undefined) ?? [];
      if (fills.length < 1) throw new Error('「突破」至少消耗 1 颗冥想骰');
      const spec: SlotSpec[] = Array.from({ length: fills.length }, () => ({ kind: 'meditation' as const }));
      const effective = paySlots(g, player, spec, fills, reportConsumed);
      const count = effective.length;
      const opponent: PlayerId = player === 'A' ? 'B' : 'A';
      const oppDef = g.players[opponent].areas.defense;
      const required = Math.min(count, oppDef.length);
      const chosen = ((params.opponentDefenseDieIds as string[] | undefined) ?? [])
        .filter((id) => oppDef.some((d) => d.id === id))
        .slice(0, required);
      for (const d of oppDef) {
        if (chosen.length >= required) break;
        if (!chosen.includes(d.id)) chosen.push(d.id);
      }
      if (chosen.length !== required) throw new Error(`「突破」需弃置恰好 ${required} 颗对方防御骰`);
      const def = chosen.map((id) => oppDef.find((d) => d.id === id)).filter((d): d is Die => d !== undefined);
      consumeDice(g, g.players[opponent], 'defense', chosen);
      logLine(
        g,
        `${pname(player)} 发动「突破」：消耗 ${count} 颗冥想骰（${vals(effective)}），弃置 ${pname(opponent)} 的 ${chosen.length} 颗防御骰（${vals(def)}）`,
      );
    },
  },
  // 影袭：使 1 个能力骰点数下降 X（最低 1）→ 按新点数移到对应区域；视为以 X 点进行 1 次（虚拟）攻击
  'yingle.yingxi': {
    run({ g, player, params }) {
      const p = g.players[player];
      const dieId = params.dieId as string;
      const x = params.x as number;
      if (!Number.isInteger(x) || x < 1) throw new Error('x must be >= 1');
      const kinds = ['attack', 'defense', 'meditation'] as const;
      let old = 0;
      let found = false;
      for (const k of kinds) {
        const die = p.areas[k].find((d) => d.id === dieId);
        if (die) {
          old = die.value;
          found = true;
          break;
        }
      }
      if (!found) throw new Error(`die not found: ${dieId}`);
      if (x > old - 1) throw new Error('x cannot reduce the die below 1');
      const newValue = old - x;
      for (const k of kinds) {
        p.areas[k] = p.areas[k].filter((d) => d.id !== dieId);
      }
      const dist = p.artifacts.find((a) => a.column === 2)!.distribution!;
      const newKind = areaOf(newValue, dist);
      p.areas[newKind].push({ id: dieId, value: newValue, kind: newKind });
      // 动效旁路：该骰"旧位 → 中间（翻面到新点数）→ 新区域"；并计入"代价时长" → 后面的虚拟攻击 + 黑线会等它播完
      fxPush({ kind: 'move', player, dieIds: [dieId] });
      virtualAttack(g, player, x, { skill: '影袭', owner: player });
      logLine(
        g,
        `${pname(player)} 发动「影袭」：将 1 颗能力骰由 ${old} 点降为 ${newValue} 点（X=${x}），并视为以 ${x} 点发起攻击`,
      );
    },
  },
  // 明镜·必杀 斩神切：弃置自己全部能力骰；对方弃置对应种类对应数量；造成 X 真实伤害；获得 3 随机防御骰
  'mingjing.ultimate': {
    run({ g, player, rng, params }) {
      const p = g.players[player];
      const opponent: PlayerId = player === 'A' ? 'B' : 'A';
      const o = g.players[opponent];
      const own = { attack: p.areas.attack.length, defense: p.areas.defense.length, meditation: p.areas.meditation.length };
      const total = own.attack + own.defense + own.meditation;
      // 弃置自己全部能力骰（一次效果 → 走 consumeDiceByKind：口径 (B) 下「雨落狂流」只 +1，与类型数无关）
      consumeDiceByKind(g, p, {
        attack: p.areas.attack.map((d) => d.id),
        defense: p.areas.defense.map((d) => d.id),
        meditation: p.areas.meditation.map((d) => d.id),
      });
      const chosen = (params.opponentDiceByKind as Record<string, string[]>) ?? {};
      // L01 断苇一斩：改为"弃置对方**全部**能力骰"
      const discardAll = params.opponentDiscardAll === true;
      let oppDiscarded = 0;
      const oppByKind: Partial<Record<DiceKind, string[]>> = {};
      for (const k of ['attack', 'defense', 'meditation'] as const) {
        const want = discardAll ? o.areas[k].length : Math.min(own[k], o.areas[k].length);
        const provided = (chosen[k] ?? []).filter((id) => o.areas[k].some((d) => d.id === id)).slice(0, want);
        const remaining = o.areas[k].filter((d) => !provided.includes(d.id)).map((d) => d.id);
        while (provided.length < want) provided.push(remaining.shift()!);
        if (provided.length) {
          oppByKind[k] = provided;
          oppDiscarded += provided.length;
        }
      }
      consumeDiceByKind(g, o, oppByKind); // 一次效果 → 对方 L01 只 +1
      const x = total + oppDiscarded;
      logLine(
        g,
        `${pname(player)} 发动必杀「斩神切」${discardAll ? '（「断苇一斩」：改为弃置对方全部能力骰）' : ''}：弃置自己全部 ${total} 颗能力骰，${pname(
          opponent,
        )} 弃置 ${oppDiscarded} 颗，造成 ${x} 点真实伤害，获得 3 颗防御骰`,
      );
      dealTrueDamage(g, opponent, x, player);
      if (g.phase === 'gameOver') return;
      gainRandomDice(g, player, 'defense', 3, rng);
    },
  },
  // 完杀·必杀 零时枭首：消耗 1 攻击骰 → 弃对方 X 个防御骰；若对方仍有剩余防御骰，再获得 X 个随机攻击骰（X=消耗骰点数）
  'wansha.ultimate': {
    run({ g, player, rng, params, reportConsumed }) {
      const opponent: PlayerId = player === 'A' ? 'B' : 'A';
      const o = g.players[opponent];
      const effective = paySlots(
        g,
        player,
        [{ kind: 'attack' }],
        (params.costSlots as SlotFill[] | undefined) ?? [],
        reportConsumed,
      );
      const x = effective[0]?.value ?? 0;
      const wanted = ((params.opponentDefenseDieIds as string[]) ?? [])
        .filter((id) => o.areas.defense.some((d) => d.id === id))
        .slice(0, x);
      if (wanted.length < x) {
        for (const d of o.areas.defense) {
          if (wanted.length >= x) break;
          if (!wanted.includes(d.id)) wanted.push(d.id);
        }
      }
      consumeDice(g, o, 'defense', wanted);
      const gained = o.areas.defense.length > 0;
      if (gained) {
        gainRandomDice(g, player, 'attack', x, rng);
      }
      logLine(
        g,
        `${pname(player)} 发动必杀「零时枭首」：消耗 1 颗攻击骰（${x}点），弃置 ${pname(
          opponent,
        )} 的 ${wanted.length} 颗防御骰${gained ? `，并获得 ${x} 颗攻击骰` : ''}`,
      );
    },
  },
  // A07 异相·完杀·充能：获得 1 个点数等于当前充能层数的**防御骰**
  'wansha.alt.charge': {
    run({ g, player, artifact }) {
      g.players[player].areas.defense.push(createDie(newDieId(`${player}-`), artifact.chargeLayer, 'defense'));
      logLine(g, `${pname(player)} 「历王之血之印」充能效果：获得 1 颗 ${artifact.chargeLayer} 点防御骰`);
    },
  },
  // A07 异相·完杀·必杀：对方防御骰数 ≥ 你攻击骰数时，弃对方防御骰至与你攻击骰数相等（发起者选，FAQ 43.1.1）；本回合双方持续失效
  'wansha.alt.ultimate': {
    run({ g, player, params }) {
      const p = g.players[player];
      const opponent: PlayerId = player === 'A' ? 'B' : 'A';
      const o = g.players[opponent];
      const myAtk = p.areas.attack.length;
      const oppDef = o.areas.defense;
      // 门槛：对方防御骰数 ≥ 你攻击骰数才能启动（与 getLegalActions 的枚举条件一致）
      if (oppDef.length < myAtk) {
        throw new Error('「历王之血之印」只能在对方防御骰数 ≥ 你攻击骰数时发动');
      }
      const required = Math.max(0, oppDef.length - myAtk);
      const wanted = ((params.opponentDefenseDieIds as string[]) ?? [])
        .filter((id) => oppDef.some((d) => d.id === id))
        .slice(0, required);
      if (wanted.length < required) {
        for (const d of oppDef) {
          if (wanted.length >= required) break;
          if (!wanted.includes(d.id)) wanted.push(d.id);
        }
      }
      if (wanted.length !== required) throw new Error(`「历王之血之印」需弃置恰好 ${required} 颗对方防御骰`);
      consumeDice(g, o, 'defense', wanted);
      for (const id of ['A', 'B'] as PlayerId[]) {
        for (const a of g.players[id].artifacts) a.continuousLostThisTurn = true;
        // 传奇面板的持续技能同样失效（否则界面上只有神器持续转灰、传奇持续仍是绿的）
        if (g.players[id].legend) g.players[id].legend!.continuousLostThisTurn = true;
      }
      logLine(
        g,
        `${pname(player)} 发动必杀「历王之血之印」：弃置 ${pname(opponent)} 的 ${wanted.length} 颗防御骰（至与你攻击骰数 ${myAtk} 相等）；直到本回合结束前，双方所有持续式效果失效`,
      );
    },
  },
  // 009 高塔铁幕·充能：对方有攻击骰时，进入待结算，由发动者选择将其中 1 颗点数改为 1（保留原区域）
  'guwang.charge': {
    run({ g, player }) {
      const opponent: PlayerId = player === 'A' ? 'B' : 'A';
      if (g.players[opponent].areas.attack.length > 0) {
        // 排队式（等价于直接挂起，但已有待决策时不会覆盖）
        queuePending(g, { kind: 'guwangCharge', player });
        pumpPending(g);
        logLine(g, `${pname(player)} 「高塔铁幕」充能效果：可选择将 ${pname(opponent)} 的 1 个攻击骰点数变更为 1`);
      } else {
        logLine(g, `${pname(player)} 「高塔铁幕」充能效果：对方没有攻击骰，无法变更点数`);
      }
    },
  },
  // A01 不败之王·充能：**强制执行**——你视为以 5 点攻击 1 次，随后对方视为以 3 点攻击你 2 次（逐次完整结算）
  'guwang.alt.charge': {
    run({ g, player }) {
      const opponent: PlayerId = player === 'A' ? 'B' : 'A';
      // §19⑨ 多段攻击源：A01 不败之王（virtualQueue）
      g.virtualQueue = [
        { attacker: player, value: 5, label: '不败之王', owner: player },
        { attacker: opponent, value: 3, label: '不败之王', owner: player },
        { attacker: opponent, value: 3, label: '不败之王', owner: player },
      ];
      logLine(
        g,
        `${pname(player)} 「不败之王」充能效果（强制）：视为先以 5 点攻击对方，随后对方视为以 3 点攻击你 2 次（依次结算）`,
      );
      pumpAttackQueue(g);
    },
  },
  // 009 高塔铁幕·必杀：弃置自己全部能力骰 → 获得随机防御骰直至能力骰总数达到意志上限 → 立即结束主要阶段
  'guwang.ultimate': {
    run({ g, player, rng, endMainPhase }) {
      const p = g.players[player];
      const discarded = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation];
      // 弃置自己全部能力骰（一次效果 → 走 consumeDiceByKind：口径 (B) 下「雨落狂流」只 +1）
      consumeDiceByKind(g, p, {
        attack: p.areas.attack.map((d) => d.id),
        defense: p.areas.defense.map((d) => d.id),
        meditation: p.areas.meditation.map((d) => d.id),
      });
      const cap = effectiveWill(p);
      const gained = gainRandomDice(g, player, 'defense', Math.max(0, cap - totalDice(p)), rng);
      logLine(
        g,
        `${pname(player)} 发动必杀「高塔铁幕」：弃置全部 ${discarded.length} 颗能力骰，获得 ${gained.length} 颗随机防御骰（能力骰总数达到意志上限 ${cap}），立即结束主要阶段`,
      );
      endMainPhase();
    },
  },
  // 007 战争横扫：各消耗 1 攻/防/冥 → 弃对方各 1 → floor(点数和/2) 真实伤害
  'zhuzai.sweep': {
    run({ g, player, params, reportConsumed }) {
      const opp: PlayerId = player === 'A' ? 'B' : 'A';
      const effective = paySlots(
        g,
        player,
        [{ kind: 'attack' }, { kind: 'defense' }, { kind: 'meditation' }],
        (params.costSlots as SlotFill[] | undefined) ?? [],
        reportConsumed,
      );
      const discard = (params.discard ?? {}) as { attack?: string; defense?: string; meditation?: string };
      let sum = 0;
      for (const e of effective) sum += e.value;
      let discarded = 0;
      const oppByKind: Partial<Record<DiceKind, string[]>> = {};
      for (const k of ['attack', 'defense', 'meditation'] as const) {
        const id = discard[k];
        if (id && g.players[opp].areas[k].some((d) => d.id === id)) {
          (oppByKind[k] ??= []).push(id);
          discarded++;
        }
      }
      consumeDiceByKind(g, g.players[opp], oppByKind); // 一次效果 → 对方 L01 只 +1
      const dmg = Math.floor(sum / 2);
      dealTrueDamage(g, opp, dmg, player);
      logLine(
        g,
        `${pname(player)} 发动「战争横扫」：消耗 攻/防/冥 各 1（点数和 ${sum}），弃置对方 ${discarded} 颗能力骰，造成 ${dmg} 点真实伤害`,
      );
      bachengHook(g, player, effective.length, discarded);
    },
  },
  // 007 震荡斩击：消耗 4 颗同类型 → 弃对方 4 颗同类型 → floor(点数和/2) 真实伤害
  'zhuzai.smash': {
    run({ g, player, params, reportConsumed }) {
      const opp: PlayerId = player === 'A' ? 'B' : 'A';
      const kind = params.kind as DiceKind;
      if (kind !== 'attack' && kind !== 'defense' && kind !== 'meditation') throw new Error('invalid kind');
      const effective = paySlots(
        g,
        player,
        Array.from({ length: 4 }, () => ({ kind })),
        (params.costSlots as SlotFill[] | undefined) ?? [],
        reportConsumed,
      );
      let sum = 0;
      for (const e of effective) sum += e.value;
      const oppIds = ((params.opponentDiscardIds as string[]) ?? [])
        .filter((id) => g.players[opp].areas[kind].some((d) => d.id === id))
        .slice(0, 4);
      if (oppIds.length) consumeDice(g, g.players[opp], kind, oppIds);
      const dmg = Math.floor(sum / 2);
      dealTrueDamage(g, opp, dmg, player);
      logLine(g, `${pname(player)} 发动「震荡斩击」：消耗 4 颗${kind}（点数和 ${sum}），弃置对方 ${oppIds.length} 颗同类型骰，造成 ${dmg} 点真实伤害`);
      bachengHook(g, player, effective.length, oppIds.length);
    },
  },
  // 008 王家之拳：消耗 2 冥想 → 弃置自己的 2 防御；不足 2 个时每少弃 1 个受 2 真实伤害 → 获得 4 随机防御骰；本回合攻击伤害 +1
  'tiebi.fist': {
    run({ g, player, rng, params, reportConsumed }) {
      const p = g.players[player];
      paySlots(
        g,
        player,
        [{ kind: 'meditation' }, { kind: 'meditation' }],
        (params.costSlots as SlotFill[] | undefined) ?? [],
        reportConsumed,
      );
      const defIds = (params.defenseDieIds as string[]) ?? [];
      if (new Set(defIds).size !== defIds.length) throw new Error('duplicate die id');
      const validDef = defIds.filter((id) => p.areas.defense.some((d) => d.id === id)).slice(0, 2);
      consumeDice(g, p, 'defense', validDef);
      const missing = 2 - validDef.length;
      if (missing > 0) dealTrueDamage(g, player, missing * 2, player);
      gainRandomDice(g, player, 'defense', 4, rng);
      p.buffs.push({ attr: 'attackDamage', add: 1, duration: 'thisTurn', source: '王家之拳' });
      logLine(g, `${pname(player)} 发动「王家之拳」：消耗 2 冥想，弃置 ${validDef.length} 防御${missing > 0 ? `（少弃 ${missing}，受 ${missing * 2} 真伤）` : ''}，获得 4 防御骰，本回合攻击伤害 +1`);
    },
  },
  // 011 灵能屏障·启动：消耗最多 3 个防御骰 → 获得等同消耗数量 2 倍的随机点数冥想骰
  'dunwu.barrier.activate': {
    run({ g, player, rng, params, reportConsumed }) {
      const fills = (params.costSlots as SlotFill[] | undefined) ?? [];
      if (fills.length < 1 || fills.length > 3) throw new Error('costSlots must be 1..3');
      const spec: SlotSpec[] = Array.from({ length: fills.length }, () => ({ kind: 'defense' as const }));
      const effective = paySlots(g, player, spec, fills, reportConsumed);
      const n = effective.length;
      gainRandomDice(g, player, 'meditation', n * 2, rng);
      logLine(g, `${pname(player)} 发动「灵能屏障」：消耗 ${n} 防御骰，获得 ${n * 2} 冥想骰`);
    },
  },
  // 011 灵能脉冲·启动：消耗最多 3 个攻击骰 → 获得等同消耗数量 2 倍的随机点数冥想骰
  'dunwu.pulse.activate': {
    run({ g, player, rng, params, reportConsumed }) {
      const fills = (params.costSlots as SlotFill[] | undefined) ?? [];
      if (fills.length < 1 || fills.length > 3) throw new Error('costSlots must be 1..3');
      const spec: SlotSpec[] = Array.from({ length: fills.length }, () => ({ kind: 'attack' as const }));
      const effective = paySlots(g, player, spec, fills, reportConsumed);
      const n = effective.length;
      gainRandomDice(g, player, 'meditation', n * 2, rng);
      logLine(g, `${pname(player)} 发动「灵能脉冲」：消耗 ${n} 攻击骰，获得 ${n * 2} 冥想骰`);
    },
  },
  // 012 魔女·必杀 梦醒时分：将最多 3 个冥想骰移动至自己的另一个区域（攻击/防御），保留原本点数
  'monv.ultimate': {
    run({ g, player, params }) {
      const p = g.players[player];
      const to = params.to as DiceKind;
      if (to !== 'attack' && to !== 'defense') throw new Error('destination must be attack or defense');
      const ids = (params.meditationDieIds as string[]) ?? [];
      if (ids.length < 1 || ids.length > 3) throw new Error('meditationDieIds must be 1..3');
      if (new Set(ids).size !== ids.length) throw new Error('duplicate die id');
      for (const id of ids) if (!p.areas.meditation.some((d) => d.id === id)) throw new Error(`not your meditation die: ${id}`);
      moveDice(g, player, ids, to);
      logLine(g, `${pname(player)} 发动必杀「梦醒时分」：将 ${ids.length} 颗冥想骰移动到「${to === 'attack' ? '攻击' : '防御'}骰区」（保留点数）`);
    },
  },
  // 014 净化（激活）：将对方最多 2 个「1 点」能力骰变更为 6 点并移动到对应区域
  'chengjie.jinghua': {
    run({ g, player, rng, params }) {
      const opp: PlayerId = player === 'A' ? 'B' : 'A';
      const ids = (params.targetDieIds as string[]) ?? [];
      const changed = changeOnePointDice(g, opp, ids, player, rng);
      logLine(g, `${pname(player)} 发动「净化」：变更对方 ${changed} 个能力骰（1 点 → 6 点）`);
    },
  },
  // 014 数罪并罚（激活）：同上，但对象是自己的能力骰
  'chengjie.shuzui': {
    run({ g, player, rng, params }) {
      const ids = (params.targetDieIds as string[]) ?? [];
      const changed = changeOnePointDice(g, player, ids, player, rng);
      logLine(g, `${pname(player)} 发动「数罪并罚」：变更自己 ${changed} 个能力骰（1 点 → 6 点）`);
    },
  },
  // 015 残响·必杀 绝境天神：当前生命每比初始生命低 10 点，计数 +1（向下取整，最高 4 层）
  'canxiang.juejing.ultimate': {
    run({ g, player, artifact }) {
      const p = g.players[player];
      const missing = Math.max(0, p.lifeMax - p.life);
      const layers = Math.min(4, Math.floor(missing / 10));
      artifact.count = layers;
      logLine(
        g,
        `${pname(player)} 发动必杀「绝境天神」：计数设为 ${layers}（生命 ${p.life}/${p.lifeMax}，每低 10 点计数 +1，上限 4）`,
      );
    },
  },
  // 016 虚臾·虚无形态（激活，装填即立即强制结算）：受到 10 真实伤害 → 选 1 个能力骰类型 → 获得该类型 3 点骰直至总数达意志上限
  'xuyu.void': {
    run({ g, player, params }) {
      const p = g.players[player];
      const kind = params.kind as DiceKind;
      if (kind !== 'attack' && kind !== 'defense' && kind !== 'meditation') throw new Error('invalid dice kind');
      logLine(g, `${pname(player)} 「虚无形态」激活：受到 10 点真实伤害`);
      dealTrueDamage(g, player, 10, player);
      if (g.phase === 'gameOver') return;
      const cap = effectiveWill(p);
      const n = Math.max(0, cap - totalDice(p));
      const gained: Die[] = [];
      const name = kind === 'attack' ? '攻击' : kind === 'defense' ? '防御' : '冥想';
      for (let i = 0; i < n; i++) {
        const d = createDie(newDieId(`${player}-`), 3, kind);
        p.areas[kind].push(d);
        gained.push(d);
      }
      logLine(
        g,
        `「虚无形态」：获得 ${n} 个 3 点${name}骰（能力骰总数 ${cap - n} → ${totalDice(p)}，意志上限 ${cap}）`,
      );
    },
  },
  // 016 虚臾·献祭（启动）：受到 4 真实伤害 → ①获得 3 个随机点数能力骰（按分布落区）／②本回合攻击伤害 +2
  'xuyu.sacrifice': {
    run({ g, player, rng, params }) {
      const p = g.players[player];
      const choice = params.choice === 'damage' ? 'damage' : 'dice';
      logLine(g, `${pname(player)} 发动「献祭」：受到 4 点真实伤害`);
      dealTrueDamage(g, player, 4, player);
      if (g.phase === 'gameOver') return;
      if (choice === 'damage') {
        p.buffs.push({ attr: 'attackDamage', add: 2, duration: 'thisTurn', source: '献祭' });
        logLine(g, `「献祭」：本回合你的攻击伤害 +2`);
      } else {
        const gained = gainRandomAbilityDice(g, player, 3, rng);
        logLine(g, `「献祭」：获得 3 个随机点数能力骰（${vals(gained)}），按其点数移动到对应区域`);
      }
    },
  },
  // 017 幽冥·冥界行走（启动）：消耗最多 3 个冥想骰 → 获得同等数量的随机点数攻击骰
  'youming.mingjie': {
    run({ g, player, rng, params, reportConsumed }) {
      const fills = (params.costSlots as SlotFill[] | undefined) ?? [];
      if (fills.length < 1 || fills.length > 3) throw new Error('costSlots must be 1..3');
      const spec: SlotSpec[] = Array.from({ length: fills.length }, () => ({ kind: 'meditation' as const }));
      const effective = paySlots(g, player, spec, fills, reportConsumed);
      const n = effective.length;
      const gained = gainRandomDice(g, player, 'attack', n, rng);
      logLine(
        g,
        `${pname(player)} 发动「冥界行走」：消耗 ${n} 个冥想骰（${vals(effective)}），获得 ${n} 个随机点数攻击骰（${vals(gained)}）`,
      );
    },
  },
  // 021 决意·野火燎原（激活，首次充能完成时立即强制结算）：受到 8 真实伤害 + 计数 +1
  'jueyi.wildfire': {
    run({ g, player, artifact }) {
      logLine(g, `${pname(player)} 「野火燎原」激活：受到 8 点真实伤害`);
      dealTrueDamage(g, player, 8, player);
      if (g.phase === 'gameOver') return;
      const cap = artifact.countCap ?? Infinity;
      artifact.count = Math.min(cap, artifact.count + 1);
      logLine(g, `「野火燎原」：计数 +1（${artifact.count}${Number.isFinite(cap) ? `/${cap}` : ''}）`);
    },
  },
  // 020 兽魂·熊之心（激活）：将本神器的计数重设为 2
  'shouhun.xiong': {
    run: (ctx) => resetShouhunCount(ctx.g, ctx.player, ctx.artifact, '熊之心'),
  },
  // 020 兽魂·狼之血（激活）：将本神器的计数重设为 2
  'shouhun.lang': {
    run: (ctx) => resetShouhunCount(ctx.g, ctx.player, ctx.artifact, '狼之血'),
  },
  // A04 异相·灵界熊魂（激活）：将本神器的计数重设为 2
  'shouhun.alt.xiong': {
    run: (ctx) => resetShouhunCount(ctx.g, ctx.player, ctx.artifact, '灵界熊魂'),
  },
  // A04 异相·灵界狼魂（激活）：将本神器的计数重设为 2
  'shouhun.alt.lang': {
    run: (ctx) => resetShouhunCount(ctx.g, ctx.player, ctx.artifact, '灵界狼魂'),
  },
  // 019 尘哀·蛮王之牙（启动）：消耗 X 个种类各不相同的能力骰 → 选 X 项（①②可重复）→ 刷新启动次数 + 标记移到另一侧
  'chenai.fang': {
    run({ g, player, artifact, params }) {
      const p = g.players[player];
      const opp: PlayerId = player === 'A' ? 'B' : 'A';
      const fills = (params.costSlots as SlotFill[] | undefined) ?? [];
      const picks = (params.picks as string[] | undefined) ?? [];
      const discardIds = (params.discardIds as string[] | undefined) ?? [];
      const x = fills.length;
      if (x < 1 || x > 3) throw new Error('costSlots must be 1..3');
      // 种类必须各不相同（由规格保证，这里校验）
      const kinds = fills.map((f) => {
        if (f.dieIds.length !== 1) throw new Error('each slot needs exactly 1 die');
        const found = findDieOf(g, player, f.dieIds[0]);
        if (!found) throw new Error(`not your die: ${f.dieIds[0]}`);
        return found.kind;
      });
      if (new Set(kinds).size !== kinds.length) throw new Error('消耗的能力骰种类必须各不相同');
      if (picks.length !== x) throw new Error(`必须选择 ${x} 项`);
      for (const pk of picks) if (pk !== 'discard' && pk !== 'gain') throw new Error(`invalid pick: ${pk}`);
      // 每个「① 弃置」必须指定**具体**要弃置的那颗防御骰（由发动者选择）——先校验后落状态
      const needDiscard = picks.filter((pk) => pk === 'discard').length;
      if (discardIds.length !== needDiscard) throw new Error(`需指定 ${needDiscard} 个要弃置的对方防御骰`);
      if (new Set(discardIds).size !== discardIds.length) throw new Error('要弃置的防御骰不能重复');
      const oppDef = g.players[opp].areas.defense;
      for (const id of discardIds) if (!oppDef.some((d) => d.id === id)) throw new Error(`不是对方的防御骰: ${id}`);
      const spec: SlotSpec[] = kinds.map((k) => ({ kind: k }));
      const effective = paySlots(g, player, spec, fills);
      let discarded = 0;
      let gained = 0;
      const gainedDice: Die[] = [];
      let di = 0;
      for (const pk of picks) {
        if (pk === 'discard') {
          const id = discardIds[di];
          di += 1;
          consumeDice(g, g.players[opp], 'defense', [id]);
          discarded += 1;
        } else {
          const d = createDie(newDieId(`${player}-`), 3, 'attack');
          p.areas.attack.push(d);
          gainedDice.push(d);
          gained += 1;
        }
      }
      logLine(
        g,
        `${pname(player)} 发动「蛮王之牙」：消耗 ${x} 个种类各不相同的骰（${vals(effective)}）→ ${
          discarded > 0 ? `弃置对方 ${discarded} 个防御骰` : ''
        }${discarded > 0 && gained > 0 ? '、' : ''}${gained > 0 ? `获得 ${gained} 个 3 点攻击骰（${vals(gainedDice)}）` : ''}${
          '；刷新启动次数，激活标记移至另一侧'
        }`,
      );
      // 刷新本技能的启动次数（每回合可再次启动）+ 标记移到另一侧
      g.skillsUsedThisTurn = g.skillsUsedThisTurn.filter((k) => k !== skillUseKey(player, 'chenai.fang'));
      artifact.activeMarkerSide = artifact.activeMarkerSide === 'left' ? 'right' : 'left';
      artifact.armedSide = artifact.activeMarkerSide;
      artifact.armedTurn = g.turnIndex;
    },
  },
  'zhihai.bloom.ultimate': {
    run({ g, player, artifact, rng }) {
      const x = artifact.count;
      if (x < 1) throw new Error('计数为 0，无法发动必杀');
      artifact.continuousLost = true;
      const gained = gainRandomAbilityDice(g, player, x, rng);
      logLine(
        g,
        `${pname(player)} 发动必杀「漆黑绽放」：计数 ${x}，获得 ${x} 个随机点数能力骰（${vals(gained)}）`,
      );
      logLine(g, `「${artifact.name}」：本神器失去持续式效果`);
      queuePending(g, { kind: 'zhihaiReroll', player, x, forced: false });
    },
  },
  // 022 死契·填弹（启动）：消耗 1–6 个能力骰（≥2 个时必须顺点）→ 计数 +X（上限 6）
  'siji.tiandan': {
    run({ g, player, artifact, params, reportConsumed }) {
      const ids = (params.dieIds as string[] | undefined) ?? [];
      if (ids.length < 1 || ids.length > 6) throw new Error('必须消耗 1–6 个能力骰');
      if (new Set(ids).size !== ids.length) throw new Error('duplicate die id');
      const dice: Die[] = [];
      for (const id of ids) {
        const found = findDieOf(g, player, id);
        if (!found) throw new Error(`not your ability die: ${id}`);
        dice.push(found.die);
      }
      const valueText = dice.map((d) => d.value).join('/');
      if (dice.length >= 2) {
        const sorted = dice.map((d) => d.value).sort((a, b) => a - b);
        // 顺点：连续且互不相同（不回绕，5-6-1-2-3 之类无效）
        const ok = sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1);
        if (!ok) throw new Error('消耗 2 个或更多能力骰时，其点数必须顺点');
      }
      // 「消耗 1–6 个能力骰」→ 统一走 paySlots（支持 010 置换 / 034 破障）；
      // reportConsumed 由 paySlots 按格数上报（FAQ 22.1.1：消耗 6 颗 → 6 点真伤）
      paySlots(
        g,
        player,
        dice.map((d) => ({ kind: d.kind })),
        dice.map((d) => ({ dieIds: [d.id] })),
        reportConsumed,
        'skill',
      );
      const cap = artifact.countCap ?? Infinity;
      const before = artifact.count;
      artifact.count = Math.min(cap, artifact.count + dice.length);
      logLine(
        g,
        `${pname(player)} 发动「填弹」：消耗 ${dice.length} 颗能力骰（${valueText}点），「死契」计数 ${before} → ${artifact.count}/${cap}`,
      );
      // L08 传奇面板·蛇蝎之泪（持续）：本回合中通过「填弹」**实际叠加**的计数累计 → 取其**平方**作为真实伤害（自伤）
      const gained = artifact.count - before;
      const p = g.players[player];
      p.tiandanGainedThisTurn += gained;
      if (hasActiveSkill(p, 'xiva.shexiezhilei')) {
        const x = p.tiandanGainedThisTurn * p.tiandanGainedThisTurn;
        logLine(
          g,
          `${pname(player)} 「蛇蝎之泪」：本回合「填弹」已叠加 ${p.tiandanGainedThisTurn} 点 → 受到 ${x} 点真实伤害`,
        );
        fxSkillFired(g, player, 'xiva.shexiezhilei'); // 与「填弹」同帧一起弹技能名
        dealTrueDamage(g, player, x, player); // 自伤：source=自己
      }
    },
  },
  // 023 蛇蝎·畏惧（启动）：我方先消耗 1 骰 → 对方必须消耗 1 骰（由对方选择）→ 比大小（1 视为大于 6）
  'shexie.weiju': {
    run({ g, player, params }) {
      const opp: PlayerId = player === 'A' ? 'B' : 'A';
      // 支付填法：显式 costSlots（010 置换 2 颗顶 1）优先；否则单颗 dieId
      const ids = (params.costSlots as SlotFill[] | undefined)?.[0]?.dieIds ?? (params.dieId ? [params.dieId as string] : []);
      if (ids.length !== 1 && ids.length !== 2) throw new Error('must choose 1 die (or 2 by substitution)');
      const info = abilityDieInfo(g, player, ids[0]);
      if (!info) throw new Error(`not your ability die: ${ids[0]}`);
      const oppDice = [...g.players[opp].areas.attack, ...g.players[opp].areas.defense, ...g.players[opp].areas.meditation];
      if (oppDice.length < 1) throw new Error('对方没有能力骰，无法发动「畏惧」');
      const kindCn = info.kind === 'attack' ? '攻击' : info.kind === 'defense' ? '防御' : '冥想';
      // 「消耗 1 个任意能力骰」→ 走 paySlots（支持 010 置换 / 034 破障）
      const weijuSpec: SlotSpec[] = ids.length === 2 ? [{ kind: 'meditation' }] : [{ kind: info.kind }];
      const eff = paySlots(g, player, weijuSpec, [{ dieIds: ids }], undefined, 'skill');
      const mine = eff[0].value;
      logLine(
        g,
        `${pname(player)} 发动「畏惧」：消耗 1 颗${kindCn}骰（${mine}点），对方必须消耗 1 颗能力骰`,
      );
      // 动效旁路：发起方骰停中间等对方响应（界面建"响应池"）
      fxPush({ kind: 'weiju', player, mode: 'initiate', dieIds: ids, value: mine });
      g.pending = { kind: 'weijuPay', player: opp, initiator: player, initiatorValue: mine };
    },
  },
  // 023 蛇蝎·共振（启动）：重掷我方 1 骰并按新点数落区 → 按落区类型二选一（待决策）
  'shexie.gongzhen': {
    run({ g, player, params, rng }) {
      const dieId = params.dieId as string | undefined;
      if (!dieId) throw new Error('must choose 1 die');
      const found = findDieOf(g, player, dieId);
      if (!found) throw new Error(`not your ability die: ${dieId}`);
      doReroll(g, player, [dieId], rng);
      const after = findDieOf(g, player, dieId);
      if (!after) throw new Error('reroll failed');
      const kindCn = after.kind === 'attack' ? '攻击' : after.kind === 'defense' ? '防御' : '冥想';
      logLine(g, `${pname(player)} 发动「共振」：重掷 1 颗能力骰 → ${after.die.value} 点（${kindCn}骰区）`);
      g.pending = { kind: 'gongzhenPick', player, areaKind: after.kind };
    },
  },
  // 024 狂舞·凶弹业舞（充能）：选择任意玩家的 1 颗能力骰 → 移到该玩家的另一个区域（保留点数）
  'kuangwu.charge': {
    run({ g, player, params }) {
      const owner: PlayerId = params.owner === 'opponent' ? (player === 'A' ? 'B' : 'A') : player;
      const dieId = params.dieId as string | undefined;
      const toKind = params.toKind as DiceKind | undefined;
      if (!dieId) throw new Error('must choose 1 die');
      if (toKind !== 'attack' && toKind !== 'defense' && toKind !== 'meditation') throw new Error('invalid destination');
      const found = findDieOf(g, owner, dieId);
      if (!found) throw new Error(`not ${owner}'s ability die: ${dieId}`);
      if (found.kind === toKind) throw new Error('must move to another area');
      const kindCn = (k: DiceKind): string => (k === 'attack' ? '攻击' : k === 'defense' ? '防御' : '冥想');
      const from = found.kind;
      const value = found.die.value;
      moveDice(g, owner, [dieId], toKind);
      logLine(
        g,
        `${pname(player)} 「凶弹业舞」充能效果：将 ${pname(owner)} 的 1 颗能力骰（${value}点）从${kindCn(from)}骰区移到${kindCn(toKind)}骰区`,
      );
    },
  },
  // 024 狂舞·凶弹业舞（必杀）：6 区域各选最多 3 颗 → 按顺/逆时针整体移动到下一区域（可跨玩家）
  'kuangwu.ultimate': {
    run({ g, player, params }) {
      const opp: PlayerId = player === 'A' ? 'B' : 'A';
      const groups = (params.groups as string[][] | undefined) ?? [];
      const dir = params.direction === 'ccw' ? 'ccw' : 'cw';
      if (groups.length !== 6) throw new Error('需要为 6 个区域各提供一组选择');
      // 顺时针（FAQ 24.1.1）：我冥想→我攻击→我防御→对方冥想→对方攻击→对方防御；逆时针取反
      const cw: { player: PlayerId; kind: DiceKind }[] = [
        { player, kind: 'meditation' },
        { player, kind: 'attack' },
        { player, kind: 'defense' },
        { player: opp, kind: 'meditation' },
        { player: opp, kind: 'attack' },
        { player: opp, kind: 'defense' },
      ];
      const cycle = dir === 'cw' ? cw : [...cw].reverse();
      const picked: string[][] = [];
      cycle.forEach((slot, i) => {
        const ids = groups[i] ?? [];
        if (ids.length > 3) throw new Error('每个区域最多选择 3 颗');
        if (new Set(ids).size !== ids.length) throw new Error('duplicate die id');
        for (const id of ids) {
          if (!g.players[slot.player].areas[slot.kind].some((d) => d.id === id)) {
            throw new Error(`die ${id} is not in ${slot.player}'s ${slot.kind} area`);
          }
        }
        picked.push([...ids]);
      });
      // 快照后再整体移动，避免连锁移动
      let moved = 0;
      picked.forEach((ids, i) => {
        const dest = cycle[(i + 1) % 6];
        for (const id of ids) {
          transferDice(g, cycle[i].player, [id], dest.player, dest.kind);
          moved += 1;
        }
      });
      logLine(
        g,
        `${pname(player)} 发动必杀「凶弹业舞」：双方 6 个区域各选最多 3 颗，按${dir === 'cw' ? '顺时针' : '逆时针'}移动到下一区域（共移动 ${moved} 颗）`,
      );
    },
  },
  // ── 027 寒光 ────────────────────────────────────────────────
  /** 凛冽之音（充能）：直到你自己的下个尘起阶段开始，任何玩家重掷能力骰后，被重掷方受等量真实伤害 */
  'hanguang.charge': {
    run: (ctx) => {
      const { g, player, artifact } = ctx;
      g.rerollPunish[player] = true;
      logLine(
        g,
        `${pname(player)} 充能「${artifact.name}」：「凛冽之音」生效至其下个尘起阶段开始（此后任何玩家重掷能力骰都会受等量真实伤害）`,
      );
    },
  },
  /** 凛冽之音（必杀）：取 1–6 点各 1 颗置于本神器上；回合结束时移除（使用时机在「将要使用攻击骰时」） */
  'hanguang.ultimate': {
    run: (ctx) => {
      const { g, player, artifact } = ctx;
      // id 带玩家前缀：避免双方各持同型神器（如都拿 027）时存放骰 id 跨玩家撞串
      artifact.heldDice = [1, 2, 3, 4, 5, 6].map((v) => ({ id: `${player}-${artifact.id}-held-${v}`, value: v }));
      logLine(
        g,
        `${pname(player)} 发动「凛冽之音」：从供应堆取 1–6 点骰各 1 颗置于「${artifact.name}」上（回合结束时移除）`,
      );
    },
  },
  // ── 026 哀歌 ────────────────────────────────────────────────
  /** 陷阵（持续）：实际结算在「重掷阶段结束」事件点（game.ts advancePhase） */
  'aige.xianzhen': {
    run: (ctx) => {
      logLine(ctx.g, `${pname(ctx.player)} 「陷阵」：在重掷阶段结束时结算`);
    },
  },
  /** 威压（触发）：实际结算在「使用能力骰后」（effects.ts paySlots 排队） */
  'aige.weiya': {
    run: (ctx) => {
      logLine(ctx.g, `${pname(ctx.player)} 「威压」：在使用能力骰后结算`);
    },
  },
  // ── 028 天罚 ────────────────────────────────────────────────
  /** 白昼之火（激活）：本回合攻击点数视为 6，且对方只能用冥想骰抵挡 */
  'tianfa.bairi': {
    run({ g, player }) {
      g.tianfa[player] = { blockKind: 'meditation', value: 6, damageCount: 0, key: 'tianfa.bairi' };
      logLine(
        g,
        `${pname(player)} 「白昼之火」激活：直到本回合结束前，你的攻击不可用防御骰抵挡（只能用冥想骰），且攻击点数始终视为 6`,
      );
    },
  },
  /** 陨落（激活）：本回合攻击点数视为 6，且对方只能用攻击骰抵挡 */
  'tianfa.yunluo': {
    run({ g, player }) {
      g.tianfa[player] = { blockKind: 'attack', value: 6, damageCount: 0, key: 'tianfa.yunluo' };
      logLine(
        g,
        `${pname(player)} 「陨落」激活：直到本回合结束前，你的攻击不可用防御骰抵挡（只能用攻击骰），且攻击点数始终视为 6`,
      );
    },
  },
  // ── A05 异相·天罚 ──────────────────────────────────────────
  /** 深空之火（激活）：本回合攻击不可用防御骰抵挡（只能用冥想骰），且攻击伤害 +3；2 次伤害后结束主要阶段 */
  'tianfa.alt.shenkong': {
    run({ g, player }) {
      g.tianfa[player] = { blockKind: 'meditation', damageCount: 0, key: 'tianfa.alt.shenkong' };
      g.players[player].buffs.push({ attr: 'attackDamage', add: 3, duration: 'thisTurn', source: '深空之火' });
      logLine(
        g,
        `${pname(player)} 「深空之火」激活：直到本回合结束前，你的攻击不可用防御骰抵挡（只能用冥想骰）、攻击伤害 +3；本回合攻击造成 2 次伤害后立即结束主要阶段`,
      );
    },
  },
  /** 陨落（激活·异相）：本回合攻击不可用防御骰抵挡（只能用攻击骰），且攻击伤害 +3；2 次伤害后结束主要阶段 */
  'tianfa.alt.yunluo': {
    run({ g, player }) {
      g.tianfa[player] = { blockKind: 'attack', damageCount: 0, key: 'tianfa.alt.yunluo' };
      g.players[player].buffs.push({ attr: 'attackDamage', add: 3, duration: 'thisTurn', source: '陨落' });
      logLine(
        g,
        `${pname(player)} 「陨落」激活：直到本回合结束前，你的攻击不可用防御骰抵挡（只能用攻击骰）、攻击伤害 +3；本回合攻击造成 2 次伤害后立即结束主要阶段`,
      );
    },
  },
  // ── 029 真言 ────────────────────────────────────────────────
  /** 全知（持续）：实际结算在补充/重掷阶段的落区（game.ts 排队 quanzhiAssign）；属性 +1 在 derive.ts */
  'zhenyan.quanzhi': {
    run: (ctx) => {
      logLine(ctx.g, `${pname(ctx.player)} 「全知」：在补充阶段与重掷阶段由玩家自行分配全部能力骰落区`);
    },
  },
  /** 神圣干涉（激活）：把最多 3 个能力骰**统一改为同一个指定点数**并移到对应区域，然后回复 3 点生命（FAQ 29.2.1） */
  'zhenyan.ganshe': {
    run({ g, player, params }) {
      const p = g.players[player];
      const value = params.value as number | undefined;
      const ids = (params.dieIds as string[] | undefined) ?? [];
      if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 6) {
        throw new Error('「神圣干涉」必须指定 1–6 的整数点数');
      }
      const v = value as number;
      if (ids.length > 3) throw new Error('「神圣干涉」最多改变 3 个能力骰');
      if (new Set(ids).size !== ids.length) throw new Error('duplicate die id');
      const dist = emptyDistribution(p);
      if (!dist) throw new Error(`player ${player} has no distribution`);
      for (const id of ids) if (!findDieOf(g, player, id)) throw new Error(`not your die: ${id}`);
      const toKind = areaOf(v, dist);
      for (const id of ids) {
        setDieValue(g, player, id, v);
        moveDice(g, player, [id], toKind);
      }
      const kindCn = toKind === 'attack' ? '攻击' : toKind === 'defense' ? '防御' : '冥想';
      logLine(
        g,
        `${pname(player)} 「神圣干涉」激活：将 ${ids.length} 个能力骰统一改为 ${v} 点并移入${kindCn}骰区`,
      );
      const healed = heal(g, player, 3);
      logLine(g, `「神圣干涉」：回复 ${healed} 点生命`);
    },
  },
  // ── 030 救赎 ────────────────────────────────────────────────
  /** 寰宇飞升（必杀）：消耗 4 冥想骰 → 获得 3 攻击骰 + 3 防御骰 → 回复 10 点生命 → 本神器失去持续式效果 */
  'jiushu.huanyu.ultimate': {
    run({ g, player, artifact, rng, params }) {
      const fills = (params.costSlots as SlotFill[] | undefined) ?? [];
      if (fills.length !== 4) throw new Error('「寰宇飞升」必须消耗 4 个冥想骰');
      const spec: SlotSpec[] = Array.from({ length: 4 }, () => ({ kind: 'meditation' as const }));
      const eff = paySlots(g, player, spec, fills);
      const atk = gainRandomDice(g, player, 'attack', 3, rng);
      const def = gainRandomDice(g, player, 'defense', 3, rng);
      const healed = heal(g, player, 10);
      artifact.continuousLost = true;
      logLine(
        g,
        `${pname(player)} 发动必杀「寰宇飞升」：消耗 ${eff.length} 个冥想骰（${vals(eff)}）→ 获得 3 个随机攻击骰（${vals(atk)}）与 3 个随机防御骰（${vals(def)}）→ 回复 ${healed} 点生命`,
      );
      logLine(g, `「${artifact.name}」：本神器失去持续式效果`);
    },
  },
  // ── 031 恶兆 ────────────────────────────────────────────────
  /** 血祭（持续）：实际结算在「攻击结算完成」事件点（combat.ts afterAttackResolved） */
  'ezhao.xueji': {
    run: (ctx) => {
      logLine(ctx.g, `${pname(ctx.player)} 「血祭」：在每次攻击结算后结算`);
    },
  },
  /** 清算（激活）：发动者弃置对方 X 个能力骰（X=计数）；不足 X 则每个差 3 点真实伤害；随后计数 −1 */
  'ezhao.qingsuan': {
    run({ g, player, artifact, params }) {
      const oppId: PlayerId = player === 'A' ? 'B' : 'A';
      const opp = g.players[oppId];
      const X = artifact.count;
      const oppDice = [...opp.areas.attack, ...opp.areas.defense, ...opp.areas.meditation];
      const d = Math.min(X, oppDice.length);
      const ids = (params.dieIds as string[] | undefined) ?? [];
      if (new Set(ids).size !== ids.length) throw new Error('duplicate die id');
      if (ids.length !== d) throw new Error(`「清算」需弃置对方 ${d} 颗能力骰（X=${X}）`);
      for (const id of ids) {
        const found = findDieOf(g, oppId, id);
        if (!found) throw new Error(`not ${oppId} ability die: ${id}`);
        consumeDice(g, opp, found.kind, [id]);
      }
      logLine(g, `${pname(player)} 发动「清算」：弃置 ${pname(oppId)} ${d} 颗能力骰（X=${X}）`);
      const shortfall = X - d;
      if (shortfall > 0 && g.phase !== 'gameOver') {
        logLine(g, `「清算」：对方只有 ${d} 颗，每差 1 颗 3 点 → 造成 ${shortfall * 3} 点真实伤害`);
        dealTrueDamage(g, oppId, shortfall * 3, player);
      }
      artifact.count = Math.max(0, artifact.count - 1);
      logLine(g, `「清算」：本神器计数 → ${artifact.count}`);
    },
  },
  // ── 032 梦魇 ────────────────────────────────────────────────
  /** 低语（持续）：实际结算在「主要阶段结束」事件点（game.ts advancePhase） */
  'mengyan.diyu': {
    run: (ctx) => {
      logLine(ctx.g, `${pname(ctx.player)} 「低语」：在你的主要阶段结束时宣称 1 个能力骰类型`);
    },
  },
  /** 恶意（启动）：消耗 1 个攻击骰 → 获得 2 个随机点数冥想骰 */
  'mengyan.eyi': {
    run({ g, player, rng, params, reportConsumed }) {
      const fills = (params.costSlots as SlotFill[] | undefined) ?? [];
      if (fills.length !== 1) throw new Error('「恶意」需消耗恰好 1 个攻击骰位');
      const eff = paySlots(g, player, [{ kind: 'attack' }], fills, reportConsumed, 'skill');
      const gained = gainRandomDice(g, player, 'meditation', 2, rng);
      logLine(
        g,
        `${pname(player)} 发动「恶意」：消耗 1 个攻击骰（${vals(eff)}），获得 2 个随机点数冥想骰（${vals(gained)}）`,
      );
    },
  },
  /** 恶意（持续）：实际是动态攻击加成（combat.ts attackDamageBonus 读取冥想骰数的一半） */
  'mengyan.eyi.continuous': {
    run: (ctx) => {
      logLine(ctx.g, `${pname(ctx.player)} 「恶意」：攻击伤害 +（冥想骰数的一半，向下取整）`);
    },
  },
  // ── 033 凋零 ────────────────────────────────────────────────
  /** 死亡亦逝（充能）：生命“抹零”——对方下降至个位 0、自己尽可能回复至个位 0（非伤害、非真伤） */
  'diaoling.charge': {
    run({ g, player }) {
      const oppId: PlayerId = player === 'A' ? 'B' : 'A';
      const opp = g.players[oppId];
      let oppDrop = 0; // 抹零造成的**实际下降量**（L11 邪灵序曲要按"生命下降"计数）
      if (opp.life % 10 !== 0) {
        const before = opp.life;
        opp.life = Math.floor(opp.life / 10) * 10;
        oppDrop = before - opp.life;
        logLine(g, `${pname(oppId)} 的生命值下降（抹零）${before} → ${opp.life}`);
      }
      const me = g.players[player];
      if (me.life % 10 !== 0) {
        const before = me.life;
        me.life = Math.min(me.lifeMax, Math.ceil(me.life / 10) * 10);
        logLine(g, `${pname(player)} 的生命值回复（抹零）${before} → ${me.life}`);
      }
      checkLifeEnd(g);
      // L05 复仇之灵：033 抹零是非伤害改值，但**生命十位数变化同样触发**
      checkLifeTens(g, oppId);
      checkLifeTens(g, player);
      // L11 邪灵序曲：抹零属于**非伤害的"生命下降"** → 依然计数（自己那条是"回复"、不计）
      if (oppDrop > 0) {
        noteLifeDrop(g, oppId, oppDrop);
        // 动效旁路：抹零＝非伤害的"生命下降" → 仍飞**白墨线**（从 033 卡图 → 对方生命条），但界面**不抖**（drop=true）
        fxSetSource({ player, artifactId: '033', side: 'only', skillKey: 'diaoling.charge' });
        fxTrueLine(player, oppId, oppDrop, true);
      }
    },
  },
  /** 死亡亦逝（持续）：实际结算在「回合结束」事件点（game.ts advancePhase） */
  'diaoling.siwang': {
    run: (ctx) => {
      logLine(ctx.g, `${pname(ctx.player)} 「死亡亦逝」：在回合结束时结算`);
    },
  },
  // ── 035 千劫 ────────────────────────────────────────────────
  /** 万丈明光（持续）：属性在 derive.ts；主要阶段开始弃 2 骰由 game.ts 排队 */
  'qianjie.wanzhang': {
    run: (ctx) => {
      logLine(ctx.g, `${pname(ctx.player)} 「万丈明光」：速度 +3、意志 +2；主要阶段开始时弃 2 个能力骰`);
    },
  },
  /** 超度（启动）：消耗 2 个点数相同的冥想骰（支持真实之剑置换）→ 5 真伤 → 重掷任意玩家一区并按分布落区 */
  'qianjie.chaodu': {
    run({ g, player, rng, params, reportConsumed }) {
      const fills = (params.costSlots as SlotFill[] | undefined) ?? [];
      if (fills.length !== 2) throw new Error('「超度」需消耗恰好 2 个冥想骰位');
      // 先校验（含置换值 5），非法则不改状态
      const values = fills.map((f) => {
        const ids = f.dieIds ?? [];
        if (ids.length === 2) return 5; // 置换
        if (ids.length === 1) {
          const found = findDieOf(g, player, ids[0]);
          if (!found) throw new Error(`not your die: ${ids[0]}`);
          if (found.kind !== 'meditation') throw new Error('「超度」需消耗冥想骰');
          return found.die.value;
        }
        throw new Error('each slot needs 1 (real) or 2 (converted) dice');
      });
      if (values[0] !== values[1]) throw new Error('「超度」消耗的 2 颗冥想骰点数必须相同');
      paySlots(g, player, [{ kind: 'meditation' }, { kind: 'meditation' }], fills, reportConsumed, 'skill');
      const oppId: PlayerId = player === 'A' ? 'B' : 'A';
      logLine(g, `${pname(player)} 发动「超度」：消耗 2 颗同点数冥想骰（${values[0]} 点），造成 5 点真实伤害`);
      dealTrueDamage(g, oppId, 5, player);
      if ((g.phase as string) === 'gameOver') return;
      const targetOwner: PlayerId = params.targetOwner === 'opponent' ? oppId : player;
      const targetKind = params.targetKind as DiceKind;
      if (targetKind !== 'attack' && targetKind !== 'defense' && targetKind !== 'meditation') {
        throw new Error('invalid target area');
      }
      const ids = g.players[targetOwner].areas[targetKind].map((d) => d.id);
      const kindCn = targetKind === 'attack' ? '攻击' : targetKind === 'defense' ? '防御' : '冥想';
      if (ids.length === 0) {
        logLine(g, `「超度」：所选${kindCn}骰区没有能力骰，无需重掷`);
        return;
      }
      doReroll(g, targetOwner, ids, rng);
      logLine(g, `「超度」：重掷 ${pname(targetOwner)} 的${kindCn}骰区全部 ${ids.length} 颗，并按新点数落区`);
    },
  },
  // ── 036 无相 ────────────────────────────────────────────────
  /** 万象俱灭（充能·必执行）：弃任意玩家 1 个能力骰，并使该玩家回复 3 点生命 */
  'wuxiang.charge': {
    run({ g, player, params }) {
      const owner: PlayerId = params.owner === 'opponent' ? (player === 'A' ? 'B' : 'A') : player;
      const dieId = params.dieId as string | undefined;
      if (!dieId) throw new Error('「万象俱灭」需选择 1 颗能力骰');
      const found = findDieOf(g, owner, dieId);
      if (!found) throw new Error(`not ${owner}'s ability die: ${dieId}`);
      consumeDice(g, g.players[owner], found.kind, [dieId]);
      const healed = heal(g, owner, 3);
      logLine(
        g,
        `${pname(player)} 「万象俱灭」充能：弃置 ${pname(owner)} 的 1 颗能力骰（${found.die.value} 点），其回复 ${healed} 点生命`,
      );
    },
  },
  /** 万象俱灭（必杀）：保留 1–6 点各 1 个，弃置双方其余全部能力骰；真伤 = 被弃骰的不同点数之和 */
  'wuxiang.wanxiang.ultimate': {
    run({ g, player, params }) {
      const keepIds = (params.keepIds as string[] | undefined) ?? [];
      if (new Set(keepIds).size !== 6) throw new Error('「万象俱灭」需为 1–6 点各保留 1 个能力骰');
      const all: { who: PlayerId; kind: DiceKind; die: Die }[] = [];
      for (const who of ['A', 'B'] as PlayerId[]) {
        for (const k of KINDS) {
          for (const d of g.players[who].areas[k]) all.push({ who, kind: k, die: d });
        }
      }
      const keep = new Set(keepIds);
      const kept = all.filter((x) => keep.has(x.die.id));
      if (kept.length !== 6) throw new Error('保留的骰不存在或重复');
      const pips = kept.map((x) => x.die.value).sort((a, b) => a - b);
      if (pips.join(',') !== '1,2,3,4,5,6') throw new Error('保留的骰必须恰好是 1–6 点各 1 个');
      const discarded = all.filter((x) => !keep.has(x.die.id));
      for (const x of discarded) {
        g.players[x.who].areas[x.kind] = g.players[x.who].areas[x.kind].filter((d) => d.id !== x.die.id);
      }
      const distinct = new Set(discarded.map((x) => x.die.value));
      const dmg = [...distinct].reduce((a, b) => a + b, 0);
      const oppId: PlayerId = player === 'A' ? 'B' : 'A';
      logLine(
        g,
        `${pname(player)} 发动必杀「万象俱灭」：双方各保留 1–6 点骰 1 个，弃置其余全部能力骰；造成 ${dmg} 点真实伤害`,
      );
      dealTrueDamage(g, oppId, dmg, player);
    },
  },
  // ── 034 金刚 ────────────────────────────────────────────────
  'jingang.pozhang': {
    run({ g, player, artifact, params }) {
      loadJingangDice(g, player, artifact, params);
    },
  },
  'jingang.puti': {
    run({ g, player, artifact, params }) {
      loadJingangDice(g, player, artifact, params);
    },
  },
  // A03 金刚·异相（修罗的破障 / 修罗的菩提 激活）：2 个任意点数（可相同）存放，不入区域
  'jingang.alt.pozhang': {
    run({ g, player, artifact, params }) {
      loadJingangDice(g, player, artifact, params, 2, false);
    },
  },
  'jingang.alt.puti': {
    run({ g, player, artifact, params }) {
      loadJingangDice(g, player, artifact, params, 2, false);
    },
  },
  'jingang.pozhang.continuous': {
    run: (ctx) => {
      logLine(ctx.g, `${pname(ctx.player)} 「破障」：神器上的骰可当作自己的能力骰使用/消耗`);
    },
  },
  'jingang.puti.trigger': {
    run: (ctx) => {
      logLine(ctx.g, `${pname(ctx.player)} 「不动菩提」：在对方使用防御/攻击骰后结算`);
    },
  },
  // ── L12 传奇面板·渡世行僧 弥云 ──────────────────────────────
  /** 知我心者立地成佛（必杀·尘落前置 3）：双方 6 区中"有骰且仅有 1 种点数"的区域共 N 个 →
   *  对对方造成 **6×N 一次真伤** → 之后弃置这些区域中的全部能力骰。打死对方则不再处理弃置。 */
  'miyun.lidichengfo': {
    run({ g, player }) {
      const oppId: PlayerId = player === 'A' ? 'B' : 'A';
      const regions = lidichengfoRegions(g); // 快照符合条件的区域（与界面"发动前预览"共用同一来源）
      const n = regions.length;
      logLine(
        g,
        `${pname(player)} 发动必杀「知我心者立地成佛」：双方共有 ${n} 个"有且只有 1 种点数"的区域 → 造成 ${6 * n} 点真实伤害`,
      );
      if (n > 0) dealTrueDamage(g, oppId, 6 * n, player); // 6×N 作为**一次**真实伤害
      if ((g.phase as string) === 'gameOver') return; // 打死对方 → 之后不再处理弃置
      // 之后：弃置这些区域中的能力骰（双方；按"每个玩家一次效果"批量弃，保证 L01 雨落狂流只 +1）
      const byPlayer: Record<PlayerId, Partial<Record<DiceKind, string[]>>> = { A: {}, B: {} };
      for (const r of regions) {
        const live = r.ids.filter((id) => g.players[r.who].areas[r.kind].some((d) => d.id === id));
        if (live.length) (byPlayer[r.who][r.kind] ??= []).push(...live);
      }
      for (const who of ['A', 'B'] as PlayerId[]) {
        if (Object.keys(byPlayer[who]).length > 0) consumeDiceByKind(g, g.players[who], byPlayer[who]);
      }
      if (n > 0) logLine(g, `「立地成佛」：弃置这 ${n} 个区域中的全部能力骰`);
    },
  },
};
