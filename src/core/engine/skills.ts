import { areaOf, createDie, newDieId } from '../model/dice';
import type { Rng } from '../rng/rng';
import type { Artifact, DiceKind, Die, GameState, PlayerId, PlayerState } from '../model/types';
import { skillActive, hasActiveSkill } from './skill-state';
import { checkLifeEnd, dealTrueDamage, virtualAttack } from './combat';
import { abilityDieInfo, findDieOf, gainRandomAbilityDice, gainRandomDice, heal, moveDice, paySlots, setDieValue, transferDice, type SlotFill, type SlotSpec } from './effects';
import { doReroll } from './phases';
import { queuePending } from './pending';
import { effectiveWill, emptyDistribution, totalDice } from './derive';
import { logLine, pname, vals } from './log';
export { skillActive, hasActiveSkill };

const KINDS: DiceKind[] = ['attack', 'defense', 'meditation'];

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
    const me = g.players[self];
    const gained: Die[] = [];
    for (let i = 0; i < 2; i++) {
      const d = createDie(newDieId(`${self}-`), rng.rollDie(), 'meditation');
      me.areas.meditation.push(d);
      gained.push(d);
    }
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

/** 从玩家的某区域移除指定骰（校验归属），返还供应堆 */
export function consumeDice(p: PlayerState, kind: DiceKind, ids: string[]): void {
  const area = p.areas[kind];
  for (const id of ids) {
    const idx = area.findIndex((d) => d.id === id);
    if (idx < 0) throw new Error(`not a ${kind} die: ${id}`);
    area.splice(idx, 1);
  }
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
  }
}

/** 034 金刚·激活（破障 / 不动菩提同效）：清空神器上的骰 → 放入 3 个点数互不相同的骰（不入区域） */
function loadJingangDice(
  g: GameState,
  player: PlayerId,
  artifact: Artifact,
  params: Record<string, unknown>,
): void {
  const pips = (params.pips as number[] | undefined) ?? [];
  const ok =
    pips.length === 3 &&
    new Set(pips).size === 3 &&
    pips.every((v) => Number.isInteger(v) && v >= 1 && v <= 6);
  if (!ok) throw new Error('「金刚」需选择 3 个互不相同的点数（1–6）');
  artifact.heldDice = pips.map((v) => ({ id: `${artifact.id}-j${v}-${g.turnIndex}`, value: v }));
  logLine(
    g,
    `${pname(player)} 「${artifact.name}」激活：移除原有存放骰，放入 3 个点数互不相同的骰（${pips.join('/')}）`,
  );
}

export const SKILL_HANDLERS: Record<string, SkillHandler> = {
  // 淬炼：消耗 1 攻击骰 → 本神器计数 +1（上限 3）
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
      const p = g.players[player];
      const effective = paySlots(
        g,
        player,
        [{ kind: 'attack' }, { kind: 'attack' }],
        (params.costSlots as SlotFill[] | undefined) ?? [],
        reportConsumed,
      );
      const def: Die[] = [];
      for (let i = 0; i < 2; i++) {
        const d = createDie(newDieId(`${player}-`), rng.rollDie(), 'defense');
        p.areas.defense.push(d);
        def.push(d);
      }
      const med = createDie(newDieId(`${player}-`), rng.rollDie(), 'meditation');
      p.areas.meditation.push(med);
      logLine(
        g,
        `${pname(player)} 发动「潜行」：消耗 2 颗攻击骰（${vals(effective)}），获得 2 颗防御骰（${vals(
          def,
        )}）与 1 颗冥想骰（${med.value}点）`,
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
      consumeDice(g.players[opponent], 'defense', defIds);
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
      virtualAttack(g, player, x);
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
      p.areas.attack = []; p.areas.defense = []; p.areas.meditation = [];
      const chosen = (params.opponentDiceByKind as Record<string, string[]>) ?? {};
      let oppDiscarded = 0;
      for (const k of ['attack', 'defense', 'meditation'] as const) {
        const want = Math.min(own[k], o.areas[k].length);
        const provided = (chosen[k] ?? []).filter((id) => o.areas[k].some((d) => d.id === id)).slice(0, want);
        const remaining = o.areas[k].filter((d) => !provided.includes(d.id)).map((d) => d.id);
        while (provided.length < want) provided.push(remaining.shift()!);
        if (provided.length) consumeDice(o, k, provided);
        oppDiscarded += provided.length;
      }
      const x = total + oppDiscarded;
      logLine(
        g,
        `${pname(player)} 发动必杀「斩神切」：弃置自己全部 ${total} 颗能力骰，${pname(
          opponent,
        )} 弃置 ${oppDiscarded} 颗，造成 ${x} 点真实伤害，获得 3 颗防御骰`,
      );
      dealTrueDamage(g, opponent, x, player);
      if (g.phase === 'gameOver') return;
      for (let i = 0; i < 3; i++) p.areas.defense.push(createDie(newDieId(`${player}-`), rng.rollDie(), 'defense'));
    },
  },
  // 完杀·必杀 零时枭首：消耗 1 攻击骰 → 弃对方 X 个防御骰；若对方仍有剩余防御骰，再获得 X 个随机攻击骰（X=消耗骰点数）
  'wansha.ultimate': {
    run({ g, player, rng, params, reportConsumed }) {
      const p = g.players[player];
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
      consumeDice(o, 'defense', wanted);
      const gained = o.areas.defense.length > 0;
      if (gained) {
        for (let i = 0; i < x; i++) p.areas.attack.push(createDie(newDieId(`${player}-`), rng.rollDie(), 'attack'));
      }
      logLine(
        g,
        `${pname(player)} 发动必杀「零时枭首」：消耗 1 颗攻击骰（${x}点），弃置 ${pname(
          opponent,
        )} 的 ${wanted.length} 颗防御骰${gained ? `，并获得 ${x} 颗攻击骰` : ''}`,
      );
    },
  },
  // 009 高塔铁幕·充能：对方有攻击骰时，进入待结算，由发动者选择将其中 1 颗点数改为 1（保留原区域）
  'guwang.charge': {
    run({ g, player }) {
      const opponent: PlayerId = player === 'A' ? 'B' : 'A';
      if (g.players[opponent].areas.attack.length > 0) {
        g.pending = { kind: 'guwangCharge', player };
        logLine(g, `${pname(player)} 「高塔铁幕」充能效果：可选择将 ${pname(opponent)} 的 1 个攻击骰点数变更为 1`);
      } else {
        logLine(g, `${pname(player)} 「高塔铁幕」充能效果：对方没有攻击骰，无法变更点数`);
      }
    },
  },
  // 009 高塔铁幕·必杀：弃置自己全部能力骰 → 获得随机防御骰直至能力骰总数达到意志上限 → 立即结束主要阶段
  'guwang.ultimate': {
    run({ g, player, rng, endMainPhase }) {
      const p = g.players[player];
      const discarded = [...p.areas.attack, ...p.areas.defense, ...p.areas.meditation];
      p.areas.attack = [];
      p.areas.defense = [];
      p.areas.meditation = [];
      const cap = effectiveWill(p);
      const gained: Die[] = [];
      while (totalDice(p) < cap) {
        const die = createDie(newDieId(`${player}-`), rng.rollDie(), 'defense');
        p.areas.defense.push(die);
        gained.push(die);
      }
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
      for (const k of ['attack', 'defense', 'meditation'] as const) {
        const id = discard[k];
        if (id && g.players[opp].areas[k].some((d) => d.id === id)) {
          consumeDice(g.players[opp], k, [id]);
          discarded++;
        }
      }
      const dmg = Math.floor(sum / 2);
      dealTrueDamage(g, opp, dmg, player);
      logLine(
        g,
        `${pname(player)} 发动「战争横扫」：消耗 攻/防/冥 各 1（点数和 ${sum}），弃置对方 ${discarded} 颗能力骰，造成 ${dmg} 点真实伤害`,
      );
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
      if (oppIds.length) consumeDice(g.players[opp], kind, oppIds);
      const dmg = Math.floor(sum / 2);
      dealTrueDamage(g, opp, dmg, player);
      logLine(g, `${pname(player)} 发动「震荡斩击」：消耗 4 颗${kind}（点数和 ${sum}），弃置对方 ${oppIds.length} 颗同类型骰，造成 ${dmg} 点真实伤害`);
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
      consumeDice(p, 'defense', validDef);
      const missing = 2 - validDef.length;
      if (missing > 0) dealTrueDamage(g, player, missing * 2, player);
      for (let i = 0; i < 4; i++) p.areas.defense.push({ id: newDieId(`${player}-`), value: rng.rollDie(), kind: 'defense' });
      p.buffs.push({ attr: 'attackDamage', add: 1, duration: 'thisTurn', source: '王家之拳' });
      logLine(g, `${pname(player)} 发动「王家之拳」：消耗 2 冥想，弃置 ${validDef.length} 防御${missing > 0 ? `（少弃 ${missing}，受 ${missing * 2} 真伤）` : ''}，获得 4 防御骰，本回合攻击伤害 +1`);
    },
  },
  // 011 灵能屏障·启动：消耗最多 3 个防御骰 → 获得等同消耗数量 2 倍的随机点数冥想骰
  'dunwu.barrier.activate': {
    run({ g, player, rng, params, reportConsumed }) {
      const p = g.players[player];
      const fills = (params.costSlots as SlotFill[] | undefined) ?? [];
      if (fills.length < 1 || fills.length > 3) throw new Error('costSlots must be 1..3');
      const spec: SlotSpec[] = Array.from({ length: fills.length }, () => ({ kind: 'defense' as const }));
      const effective = paySlots(g, player, spec, fills, reportConsumed);
      const n = effective.length;
      for (let i = 0; i < n * 2; i++) p.areas.meditation.push({ id: newDieId(`${player}-`), value: rng.rollDie(), kind: 'meditation' });
      logLine(g, `${pname(player)} 发动「灵能屏障」：消耗 ${n} 防御骰，获得 ${n * 2} 冥想骰`);
    },
  },
  // 011 灵能脉冲·启动：消耗最多 3 个攻击骰 → 获得等同消耗数量 2 倍的随机点数冥想骰
  'dunwu.pulse.activate': {
    run({ g, player, rng, params, reportConsumed }) {
      const p = g.players[player];
      const fills = (params.costSlots as SlotFill[] | undefined) ?? [];
      if (fills.length < 1 || fills.length > 3) throw new Error('costSlots must be 1..3');
      const spec: SlotSpec[] = Array.from({ length: fills.length }, () => ({ kind: 'attack' as const }));
      const effective = paySlots(g, player, spec, fills, reportConsumed);
      const n = effective.length;
      for (let i = 0; i < n * 2; i++) p.areas.meditation.push({ id: newDieId(`${player}-`), value: rng.rollDie(), kind: 'meditation' });
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
    run({ g, player, artifact }) {
      artifact.count = 2;
      logLine(g, `${pname(player)} 「熊之心」激活：本神器计数重设为 ${artifact.count}`);
    },
  },
  // 020 兽魂·狼之血（激活）：将本神器的计数重设为 2
  'shouhun.lang': {
    run({ g, player, artifact }) {
      artifact.count = 2;
      logLine(g, `${pname(player)} 「狼之血」激活：本神器计数重设为 ${artifact.count}`);
    },
  },
  // 019 尘哀·蛮王之牙（启动）：消耗 X 个种类各不相同的能力骰 → 选 X 项（①②可重复）→ 刷新启动次数 + 标记移到另一侧
  'chenai.fang': {
    run({ g, player, artifact, params }) {
      const p = g.players[player];
      const opp: PlayerId = player === 'A' ? 'B' : 'A';
      const fills = (params.costSlots as SlotFill[] | undefined) ?? [];
      const picks = (params.picks as string[] | undefined) ?? [];
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
      const spec: SlotSpec[] = kinds.map((k) => ({ kind: k }));
      const effective = paySlots(g, player, spec, fills);
      let discarded = 0;
      let gained = 0;
      const gainedDice: Die[] = [];
      for (const pk of picks) {
        if (pk === 'discard') {
          const target = g.players[opp].areas.defense[0];
          if (target) {
            consumeDice(g.players[opp], 'defense', [target.id]);
            discarded += 1;
          }
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
      g.skillsUsedThisTurn = g.skillsUsedThisTurn.filter((k) => k !== 'chenai.fang');
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
      // 「消耗 1–6 个能力骰」→ 统一走 paySlots（支持 010 置换 / 034 破障 / 触发 026 威压）；
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
      // 「消耗 1 个任意能力骰」→ 走 paySlots（支持 010 置换 / 034 破障 / 触发 026 威压）
      const weijuSpec: SlotSpec[] = ids.length === 2 ? [{ kind: 'meditation' }] : [{ kind: info.kind }];
      const eff = paySlots(g, player, weijuSpec, [{ dieIds: ids }], undefined, 'skill');
      const mine = eff[0].value;
      logLine(
        g,
        `${pname(player)} 发动「畏惧」：消耗 1 颗${kindCn}骰（${mine}点），对方必须消耗 1 颗能力骰`,
      );
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
      artifact.heldDice = [1, 2, 3, 4, 5, 6].map((v) => ({ id: `${artifact.id}-held-${v}`, value: v }));
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
      g.tianfa[player] = { blockKind: 'meditation', value: 6, damageCount: 0 };
      logLine(
        g,
        `${pname(player)} 「白昼之火」激活：直到本回合结束前，你的攻击不可用防御骰抵挡（只能用冥想骰），且攻击点数始终视为 6`,
      );
    },
  },
  /** 陨落（激活）：本回合攻击点数视为 6，且对方只能用攻击骰抵挡 */
  'tianfa.yunluo': {
    run({ g, player }) {
      g.tianfa[player] = { blockKind: 'attack', value: 6, damageCount: 0 };
      logLine(
        g,
        `${pname(player)} 「陨落」激活：直到本回合结束前，你的攻击不可用防御骰抵挡（只能用攻击骰），且攻击点数始终视为 6`,
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
        consumeDice(opp, found.kind, [id]);
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
      if (opp.life % 10 !== 0) {
        const before = opp.life;
        opp.life = Math.floor(opp.life / 10) * 10;
        logLine(g, `${pname(oppId)} 的生命值下降（抹零）${before} → ${opp.life}`);
      }
      const me = g.players[player];
      if (me.life % 10 !== 0) {
        const before = me.life;
        me.life = Math.min(me.lifeMax, Math.ceil(me.life / 10) * 10);
        logLine(g, `${pname(player)} 的生命值回复（抹零）${before} → ${me.life}`);
      }
      checkLifeEnd(g);
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
      consumeDice(g.players[owner], found.kind, [dieId]);
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
};
