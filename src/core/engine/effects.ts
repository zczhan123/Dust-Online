import type {
  DiceKind,
  Die,
  EffectiveDie,
  GameState,
  PlayerId,
  SlotFill,
  SlotSpec,
} from '../model/types';
import { newDieId, createDie, placeDieByDistribution, areaOf } from '../model/dice';
import { SeededRng } from '../rng/rng';
import { logLine, pname } from './log';
import { hasActiveSkill, skillActive } from './skill-state';
import { emptyDistribution } from './derive';
import { dealTrueDamage } from './combat';
import { isValueLocked } from './challenge';
import { TACTIC_BY_ID } from '../content/tactics';
// 注意：与 pending.ts 是**循环引用**（pending → effects 的 gainRandomAbilityDice/withRngState）；
// 这里只在**函数体内**使用（不在模块初始化期），与 combat ↔ pending 的既有情形一致。
import { queuePending, pumpPending } from './pending';
import { fxPush, fxTacticFired, fxSkillFired } from './fx';

const kindCnOf = (k: DiceKind): string => (k === 'attack' ? '攻击' : k === 'defense' ? '防御' : '冥想');

export type { EffectiveDie, SlotFill, SlotSpec } from '../model/types';

const KINDS: DiceKind[] = ['attack', 'defense', 'meditation'];

/** 找到某玩家的某颗骰（返回所在区域与引用），找不到返回 null */
export function findDieOf(g: GameState, player: PlayerId, dieId: string): { kind: DiceKind; die: Die } | null {
  for (const kind of KINDS) {
    const die = g.players[player].areas[kind].find((d) => d.id === dieId);
    if (die) return { kind, die };
  }
  return null;
}

/** 034 金刚·破障（持续）：神器上存放的骰可当能力骰「使用/消耗」，类型按持有者第二列分布。
 *  返回 { value, kind }；若未激活 / 不在神器上 / 无分布则返回 null。 */
export function heldAsAbility(g: GameState, player: PlayerId, id: string): { value: number; kind: DiceKind } | null {
  if (!hasActiveSkill(g.players[player], 'jingang.pozhang.continuous')) return null;
  const card = g.players[player].artifacts.find((a) => (a.heldDice ?? []).some((h) => h.id === id));
  const h = card?.heldDice?.find((x) => x.id === id);
  if (!h) return null;
  const dist = emptyDistribution(g.players[player]);
  if (!dist) return null;
  return { value: h.value, kind: areaOf(h.value, dist) };
}

/** 某颗骰作为「可支付能力骰」的信息：优先区域真骰，其次 034 破障的神器存放骰 */
export function abilityDieInfo(
  g: GameState,
  player: PlayerId,
  id: string,
): { value: number; kind: DiceKind; source: 'area' | 'artifact' } | null {
  const found = findDieOf(g, player, id);
  if (found) return { value: found.die.value, kind: found.kind, source: 'area' };
  const h = heldAsAbility(g, player, id);
  return h ? { value: h.value, kind: h.kind, source: 'artifact' } : null;
}

/** 变更某颗骰的点数（保留其所在区域）。返回旧点数 */
export function setDieValue(g: GameState, player: PlayerId, dieId: string, value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 6) {
    throw new Error(`invalid die value: ${value}`);
  }
  const found = findDieOf(g, player, dieId);
  if (!found) throw new Error(`die not found: ${dieId}`);
  const old = found.die.value;
  found.die.value = value;
  return old;
}

/** 把骰子**转移给另一位玩家**的指定区域（保留点数与 id；024 狂舞用） */
export function transferDice(g: GameState, from: PlayerId, dieIds: string[], to: PlayerId, toKind: DiceKind): void {
  for (const id of dieIds) {
    const found = findDieOf(g, from, id);
    if (!found) throw new Error(`die not found: ${id}`);
    g.players[from].areas[found.kind] = g.players[from].areas[found.kind].filter((d) => d.id !== id);
    found.die.kind = toKind;
    g.players[to].areas[toKind].push(found.die);
  }
  if (dieIds.length > 0) fxPush({ kind: 'move', player: from, dieIds: [...dieIds] });
}

/** 把指定骰移动到目标区域（保留点数） */
export function moveDice(g: GameState, player: PlayerId, dieIds: string[], to: DiceKind): void {
  const p = g.players[player];
  for (const id of dieIds) {
    const found = findDieOf(g, player, id);
    if (!found) throw new Error(`die not found: ${id}`);
    p.areas[found.kind] = p.areas[found.kind].filter((d) => d.id !== id);
    found.die.kind = to;
    p.areas[to].push(found.die);
  }
  if (dieIds.length > 0) fxPush({ kind: 'move', player, dieIds: [...dieIds] });
}

/** 实际回复生命（不做任何"将要回复"的前置询问）；仅供**已经决定要回复**的结算使用。返回实际回复量 */
export function applyHeal(g: GameState, player: PlayerId, amount: number): number {
  const p = g.players[player];
  const before = p.life;
  p.life = Math.min(p.lifeMax, p.life + amount);
  const healed = p.life - before;
  fxPush({ kind: 'heal', player, actual: healed }); // 满血时 healed=0 → UI 显示 +0
  if (healed > 0) checkLifeTens(g, player);
  return healed;
}

/**
 * 回复生命的**唯一入口**：先给 L10 传奇面板·「汝等罪人」（触发：**当你将要回复生命时**）
 * 一次"改为造成等量真实伤害"的机会 —— 只要本次回复量 > 0 就把本次回复**挂起**（排队 `nudengzuiren`，
 * 由持有者决定"发动/不发动"），本函数返回 0（表示"尚未回复"；决定后的结算在 `case 'nudengzuiren'`）。
 *
 * **口径（2026-09-29 用户裁定）**：先确定数值（＝技能写明的回复量，**名义量**），再二选一
 * （用于回复 / 造成等量真实伤害）。因此：
 * - 挂起时携带的是**名义量**，**不因生命上限而削减**（46/50 被回复 10 → 询问里是 10，不是 4）；
 * - **满血（无可回复空间）也照常触发**（"将要回复生命"已发生，只是最终回复量为 0）；
 * - "不发动"分支仍走 `applyHeal`（会自动按生命上限封顶）。
 * 不持该技能 → 直接回复（`applyHeal` 自带封顶）。
 */
export function heal(g: GameState, player: PlayerId, amount: number): number {
  const p = g.players[player];
  if (amount <= 0) return 0;
  // L12 传奇面板·「见我身者菩提心」（持续）：回血时**额外回复 X**，X＝**对方** 3 个骰区中"没有能力骰"的区数。
  // 仅当本次基础回复**实际能回 >0** 时生效（满血 / 无空间 → 不算"生命回复"，不加 X）。
  if (hasActiveSkill(p, 'miyun.putixin')) {
    const base = Math.min(amount, p.lifeMax - p.life);
    if (base > 0) {
      const oppId: PlayerId = player === 'A' ? 'B' : 'A';
      const opp = g.players[oppId];
      const x = KINDS.filter((k) => opp.areas[k].length === 0).length;
      if (x > 0) {
        amount += x;
        logLine(g, `${pname(player)} 「见我身者菩提心」：对方有 ${x} 个空骰区 → 额外回复 ${x} 点生命`);
        fxSkillFired(g, player, 'miyun.putixin');
      }
    }
  }
  if (hasActiveSkill(p, 'mate.nudengzuiren')) {
    queuePending(g, { kind: 'nudengzuiren', player, amount });
    pumpPending(g);
    return 0;
  }
  return applyHeal(g, player, amount);
}

/**
 * L05 传奇面板·复仇之灵（持续）：**生命十位数发生变化**后 → **强制立即**进行 1 次
 * 「无需使用冥想骰的额外尘起行动」。由**所有改生命处**调用（`applyLifeLoss` / `heal` / 033 抹零）；
 * 同一次调用内跨多位（如 50→35）只算 1 次。无可用尘起目标时不弹（避免空待决策）。
 */
export function checkLifeTens(g: GameState, player: PlayerId): void {
  const p = g.players[player];
  const tens = Math.floor(p.life / 10);
  if (tens === p.lifeTens) return;
  p.lifeTens = tens;
  if (g.phase === 'gameOver') return;
  if (!hasActiveSkill(p, 'zoray.fuchouzhiling')) return;
  const hasTarget = p.artifacts.some(
    (a) =>
      a.column !== 3 ||
      a.chargeLayer < (a.chargeReq ?? 0) ||
      (a.chargeExtend === true && a.count < (a.countCap ?? Infinity)),
  );
  if (!hasTarget) return;
  g.pendingQueue.push({ kind: 'fuchouRise', player });
  logLine(g, `${pname(player)} 「复仇之灵」：生命十位数变化 → 立即进行 1 次无需冥想骰的额外尘起行动`);
  fxSkillFired(g, player, 'zoray.fuchouzhiling');
}

/**
 * L11 传奇面板·「邪灵序曲」（持续）：**每当有玩家的生命下降** → 为**每个**持有该面板的玩家
 * 叠加**等量**计数（上限 99）。
 * - 这是"**生命减少**"的**唯一钩子**：**伤害**（`applyLifeLoss`）、**真实伤害**（同经 `applyLifeLoss`）、
 *   **非伤害的下降**（033「抹零」的直接改值）、以及被直接设 0 等，**都必须调用它**；
 * - **上升（回复）/ 不变 不调用**；
 * - 「下降」不是关键词（说明书关键词表里只有 使用/消耗/弃置、不可抵挡、顺点、真实伤害、重设），
 *   卡面即为"生命减少"的日常语义（2026-09-28 用户裁定：含伤害与真实伤害）。
 */
export function noteLifeDrop(g: GameState, player: PlayerId, amount: number): void {
  if (amount <= 0) return;
  // Z05「绝境天神」：记录"**上个挑战者的回合**里，昔日传奇受到过伤害"（传奇回合开始时读取并清除）
  if (g.mode === 'challenge' && player === 'B' && g.activePlayer === 'A' && g.challenge) {
    g.challenge.damagedDuringChallengerTurn = true;
  }
  // T13「远见」：**第一个**仍存活、且生命降为 ≤20 的玩家 → 全局只记一次；猜对者排队发奖。
  //   死亡（生命 ≤0 → 游戏结束）不计入、不发奖（用户裁定）；L04 重开不清除（生命继承）。
  if (
    g.tacticLowFirst === null &&
    (g.phase as string) !== 'gameOver' &&
    g.players[player].life > 0 &&
    g.players[player].life <= 20
  ) {
    g.tacticLowFirst = player;
    const life = g.players[player].life;
    for (const id of ['A', 'B'] as PlayerId[]) {
      const p = g.players[id];
      if (TACTIC_BY_ID[p.tactic ?? '']?.key !== 'yuanjian') continue;
      if (p.tacticGuess === player) {
        queuePending(g, { kind: 'yuanjianGain', player: id });
        fxTacticFired(g, id);
        logLine(
          g,
          `「远见」：${pname(player)} 最先降至 20 点或以下（${life}）· ${pname(id)} 猜测正确 → 获得 1 个任意点数能力骰`,
        );
      } else if (p.tacticGuess !== null) {
        logLine(
          g,
          `「远见」：${pname(player)} 最先降至 20 点或以下（${life}）· ${pname(id)} 猜测错误（猜的是 ${pname(p.tacticGuess)}），本效果结束`,
        );
      }
    }
  }
  for (const id of ['A', 'B'] as PlayerId[]) {
    const lg = g.players[id].legend;
    if (!lg || lg.id !== 'L11') continue;
    if (!hasActiveSkill(g.players[id], 'aiwa.xielingxuqu')) continue;
    const cap = lg.countCap ?? 99;
    const before = lg.count;
    lg.count = Math.min(cap, lg.count + amount);
    if (lg.count !== before) {
      logLine(
        g,
        `「邪灵序曲」：${pname(player)} 的生命下降 ${amount} → 计数 ${before} → ${lg.count}/${cap}`,
      );
      fxSkillFired(g, id, 'aiwa.xielingxuqu');
    }
  }
}

/** 可作为「使用/消耗」支付来源的能力骰池：区域真骰 + 034/A03 破障的神器存放骰（启用破障时）。
 *  存放骰的类型按持有者**第二列**分布判定；顺序：攻击→防御→冥想。 */
export interface AbilityDie {
  id: string;
  value: number;
  kind: DiceKind;
  source: 'area' | 'artifact';
}

export function abilityDicePool(g: GameState, player: PlayerId): AbilityDie[] {
  const p = g.players[player];
  const out: AbilityDie[] = [];
  for (const k of KINDS) {
    for (const d of p.areas[k]) {
      if (isValueLocked(g, player, d.value)) continue; // Z12「不动菩提」：被封锁点数的骰**不可用**
      out.push({ id: d.id, value: d.value, kind: k, source: 'area' });
    }
  }
  if (hasActiveSkill(p, 'jingang.pozhang.continuous')) {
    const dist = emptyDistribution(p);
    if (dist) {
      for (const a of p.artifacts) {
        for (const h of a.heldDice ?? []) {
          if (isValueLocked(g, player, h.value)) continue; // 存放骰同受封锁
          out.push({ id: h.id, value: h.value, kind: areaOf(h.value, dist), source: 'artifact' });
        }
      }
    }
  }
  return out;
}

export interface CostNeed {
  attack?: number;
  defense?: number;
  meditation?: number;
}

/** 从给定池判断 `need` 是否可支付：每格 1 颗同类型能力骰；或（持 010/A02「真实之剑」）2 颗任意能力骰置换为 1 格（点数视为 5）。 */
function canPayFromPool(g: GameState, player: PlayerId, pool: AbilityDie[], need: CostNeed): boolean {
  const count = (k: DiceKind): number => pool.filter((d) => d.kind === k).length;
  const nA = need.attack ?? 0;
  const nD = need.defense ?? 0;
  const nM = need.meditation ?? 0;
  const N = nA + nD + nM;
  if (N === 0) return true;
  const deficit =
    Math.max(0, nA - count('attack')) +
    Math.max(0, nD - count('defense')) +
    Math.max(0, nM - count('meditation'));
  if (deficit === 0) return true; // 全部用同类型骰（T ≥ N 必然成立）
  if (!hasActiveSkill(g.players[player], 'shenhong.sword')) return false;
  return pool.length - N >= deficit;
}

/** `need` 是否可支付（门槛/提示判定用）。
 *  `opts.held` 是否把 034/A03 存放骰计入来源（选择向导尚不支持存放骰的技能传 false，避免"按钮点进去做不完"）。 */
export function canPayCosts(g: GameState, player: PlayerId, need: CostNeed, opts: { held: boolean }): boolean {
  const pool = abilityDicePool(g, player).filter((d) => opts.held || d.source === 'area');
  return canPayFromPool(g, player, pool, need);
}

/** 某类型最多能凑出几格（含置换；`max` 为上限，0 表示一格都付不起）。供"可变数量"技能的默认参数/范围。 */
export function maxAffordableSlots(
  g: GameState,
  player: PlayerId,
  kind: DiceKind,
  max: number,
  opts: { held: boolean },
): number {
  const pool = abilityDicePool(g, player).filter((d) => opts.held || d.source === 'area');
  for (let n = Math.min(max, Math.floor(pool.length)); n >= 1; n--) {
    if (canPayFromPool(g, player, pool, { [kind]: n })) return n;
  }
  return 0;
}

/** 构造一个**可行**的 `SlotFill[]`：优先用同类型真骰/存放骰，缺口用 2 颗任意骰置换。
 *  顺序 = 攻击→防御→冥想（每类重复 N 次），与调用方按该顺序给的 spec 对齐。 */
export function defaultCostFills(
  g: GameState,
  player: PlayerId,
  need: CostNeed,
  opts: { held: boolean },
): SlotFill[] {
  const pool = abilityDicePool(g, player).filter((d) => opts.held || d.source === 'area');
  if (!canPayFromPool(g, player, pool, need)) throw new Error('defaultCostFills: cost not payable');
  const used = new Set<string>();
  const take = (pred: (d: AbilityDie) => boolean): AbilityDie | undefined => {
    const d = pool.find((x) => !used.has(x.id) && pred(x));
    if (d) used.add(d.id);
    return d;
  };
  const specOrder: DiceKind[] = [];
  for (const k of ['attack', 'defense', 'meditation'] as DiceKind[]) {
    for (let i = 0; i < (need[k] ?? 0); i++) specOrder.push(k);
  }
  const fills: SlotFill[] = [];
  const deferred: DiceKind[] = [];
  for (const k of specOrder) {
    const d = take((x) => x.kind === k);
    if (d) fills.push({ dieIds: [d.id] });
    else deferred.push(k);
  }
  for (const _k of deferred) {
    const a = take(() => true);
    const b = take(() => true);
    if (!a || !b) throw new Error('defaultCostFills: not enough dice for conversion');
    fills.push({ dieIds: [a.id, b.id] });
  }
  return fills;
}

/** A06 异相·「幽魂不散」（持续）：某玩家的**防御/冥想骰**被「使用」（抵挡/尘起）或「弃置」（技能效果）后，
 *  获得 **X 点攻击骰**（X = 其「虚臾」神器上的攻击骰数量）；**每玩家回合上限 2**；X=0 则不获得（不提示）。
 *  注意：**「消耗」不触发**（不要在任何"消耗代价"路径调用本函数；`paySlots(reason='skill')` 已排除）。 */
export function xuyuYouhunTrigger(g: GameState, player: PlayerId, count: number): void {
  if (count <= 0) return;
  const p = g.players[player];
  const card = p.artifacts.find((a) => a.skills.some((s) => s.key === 'xuyu.alt.youhun'));
  if (!card) return;
  const sk = card.skills.find((s) => s.key === 'xuyu.alt.youhun');
  if (!sk || !skillActive(card, sk)) return;
  const x = (card.heldDice ?? []).length; // 本神器上的攻击骰数量（由「勾魂」所置）
  if (x <= 0) return; // X=0：不获得（也不提示）
  const before = g.hunhunGained[player] ?? 0;
  const n = Math.min(count, Math.max(0, 2 - before));
  if (n <= 0) return;
  for (let i = 0; i < n; i++) {
    p.areas.attack.push(createDie(newDieId(`${player}-`), x, 'attack'));
  }
  g.hunhunGained[player] = before + n;
  logLine(
    g,
    `${pname(player)} 「幽魂不散」：防御/冥想骰被使用或弃置 ${count} 个 → 获得 ${n} 个 ${x} 点攻击骰（本回合已获得 ${g.hunhunGained[player]}/2）`,
  );
  fxSkillFired(g, player, 'xuyu.alt.youhun');
}

/**
 * L06 传奇面板·圆舞（持续）：**受到自己造成的伤害**后 → **强制**将 1 个任意能力骰移动到**另 1 个区域**。
 * 由 `combat.dealTrueDamage` 在 `source === target` 时调用；无能力骰可移时不弹（避免空待决策）。
 */
export function noteYuanwu(g: GameState, player: PlayerId): void {
  if (g.phase === 'gameOver') return;
  const p = g.players[player];
  if (!hasActiveSkill(p, 'xiu.yuanwu')) return;
  const total = p.areas.attack.length + p.areas.defense.length + p.areas.meditation.length;
  if (total <= 0) return;
  g.pendingQueue.push({ kind: 'yuanwu', player });
  logLine(g, `${pname(player)} 「圆舞」：受到自己造成的伤害 → 必须将 1 个能力骰移动到另 1 个区域`);
  fxSkillFired(g, player, 'xiu.yuanwu');
}

/** 该骰是否「不符合骰点分布」＝其**点数**不在持有者**第二列分布**中、其所在区域对应的点数集里。 */
export function nonConforming(g: GameState, owner: PlayerId, kind: DiceKind, value: number): boolean {
  const dist = emptyDistribution(g.players[owner]);
  if (!dist) return false;
  return !dist[kind].includes(value);
}

/**
 * L01 传奇面板·「雨落狂流」（持续+触发）——**口径 (B)：只要"你的骰"被使用/消耗/弃置**（不论由谁执行）：
 * 若其中**含**"不符合骰点分布"的骰（按**骰主**的分布判定）→ 面板计数 +1；
 * 计数达到 3 → 重设为 0，并排队待决策 `kongYuluo`（由持有者选①/②/不发动）。
 * （"使用/消耗"本就只涉及支付方自己的骰；"弃置"不看是谁执行的——对手弃你的骰同样计数。）
 */
export function noteYuluoDiceConsumed(
  g: GameState,
  owner: PlayerId,
  dice: { kind: DiceKind; value: number }[],
): void {
  if (dice.length === 0) return;
  const p = g.players[owner];
  const lg = p.legend;
  if (!lg || lg.id !== 'L01') return;
  if (!hasActiveSkill(p, 'kong.yuluo')) return;
  if (!dice.some((d) => nonConforming(g, owner, d.kind, d.value))) return;
  lg.count += 1;
  logLine(g, `${pname(owner)} 「雨落狂流」：使用/消耗/弃置了不符合骰点分布的能力骰 → 计数 +1（${lg.count}/3）`);
  fxSkillFired(g, owner, 'kong.yuluo');
  if (lg.count >= 3) {
    lg.count = 0;
    logLine(g, `${pname(owner)} 「雨落狂流」计数达到 3 → 重设为 0，请选择 1 项执行`);
    g.pendingQueue.push({ kind: 'kongYuluo', player: owner });
  }
}

/** 支付“N 个骰位”的代价：每格 1 颗真骰(类型须匹配) 或 2 颗任意真骰(置换,值5)。
 *  移除所有真骰(返还供应堆)；返回各格“有效骰”；reportConsumed 按“格数”上报。 */
export function paySlots(
  g: GameState,
  player: PlayerId,
  spec: SlotSpec[],
  fills: SlotFill[],
  reportConsumed?: (n: number) => void,
  // 该次支付属于哪种「使用能力骰」（026「威压」只在 attack / defense / dustRise 触发；reason='skill'＝「消耗」不触发）
  reason: 'attack' | 'defense' | 'dustRise' | 'skill' = 'skill',
): EffectiveDie[] {
  if (fills.length !== spec.length) throw new Error(`expect ${spec.length} slot fills, got ${fills.length}`);
  const used = new Set<string>();
  const effective: EffectiveDie[] = [];
  const toRemove: string[] = [];
  const converted: { kind: DiceKind; values: number[]; dieIds: string[] }[] = [];
  // L01 传奇面板·雨落狂流：记录本次支付「实际用到」的区域骰（区域 + 点数），供"不符合骰点分布"判定
  const paidDice: { kind: DiceKind; value: number }[] = [];
  for (let i = 0; i < spec.length; i++) {
    const { kind } = spec[i];
    const ids = fills[i]?.dieIds ?? [];
    if (ids.length !== 1 && ids.length !== 2) throw new Error('each slot needs 1 (real) or 2 (converted) dice');
    for (const id of ids) {
      if (used.has(id)) throw new Error(`duplicate die id: ${id}`);
      used.add(id);
      const foundV = findDieOf(g, player, id);
      const heldV = foundV ? null : heldAsAbility(g, player, id);
      if (!foundV && !heldV) throw new Error(`not your die: ${id}`);
      // Z12「不动菩提」：被封锁点数的能力骰**不可"使用/消耗"**（只锁挑战者 A；不锁传奇强制弃置）
      const lockedV = foundV ? foundV.die.value : heldV!.value;
      if (isValueLocked(g, player, lockedV)) throw new Error(`「不动菩提」：${lockedV} 点的能力骰本回合不可使用/消耗`);
    }
    if (ids.length === 1) {
      const found = findDieOf(g, player, ids[0]);
      const held = found ? null : heldAsAbility(g, player, ids[0]);
      const treated = fills[i]?.treated === true;
      const actualKind = found ? found.kind : held!.kind;
      const actualValue = found ? found.die.value : held!.value;
      if (found) paidDice.push({ kind: found.kind, value: found.die.value });
      if (actualKind !== kind && !treated) throw new Error(`slot needs a ${kind} die, got ${actualKind}`);
      effective.push({
        kind,
        value: actualValue,
        source: found ? (treated ? 'treated' : 'real') : 'artifact',
        realIds: [ids[0]],
      });
      // 034/A03 金刚·破障：用「神器上的存放骰」当能力骰支付 → 弹「破障」技能名
      if (!found) fxSkillFired(g, player, 'jingang.pozhang.continuous');
      if (treated && actualKind !== kind) {
        logLine(
          g,
          `${pname(player)} 使用「奇袭」视为：${kindCnOf(actualKind)}骰 ${actualValue} 点 → 视为${kindCnOf(kind)}骰`,
        );
      }
    } else {
      converted.push({ kind, values: ids.map((id) => abilityDieInfo(g, player, id)?.value ?? 0), dieIds: [...ids] });
      for (const id of ids) {
        const f = findDieOf(g, player, id);
        if (f) paidDice.push({ kind: f.kind, value: f.die.value });
      }
      effective.push({ kind, value: 5, source: 'converted', realIds: [...ids] });
    }
    toRemove.push(...ids);
  }
  // 记录"来自卡头存放骰"的支付骰（在移除前判定）
  const heldIdSet = new Set<string>();
  for (const a of g.players[player].artifacts) for (const h of a.heldDice ?? []) heldIdSet.add(h.id);
  const fromCard = toRemove.filter((id) => heldIdSet.has(id));
  // 移除并返还供应堆（按当前所在区域移除；034 破障的神器骰从 heldDice 移除）
  for (const id of toRemove) {
    for (const k of KINDS) {
      g.players[player].areas[k] = g.players[player].areas[k].filter((d) => d.id !== id);
    }
    for (const a of g.players[player].artifacts) {
      if (a.heldDice) a.heldDice = a.heldDice.filter((h) => h.id !== id);
    }
  }
  // 动效旁路：把"本次支付"整包报给界面（有置换 或 用到存放骰时）→ 供"支付整体动画"
  if (converted.length > 0 || fromCard.length > 0) {
    fxPush({
      kind: 'pay',
      player,
      removedIds: [...toRemove],
      groups: converted.map((c) => [...c.dieIds]),
      ...(fromCard.length > 0 ? { fromCard } : {}),
    });
  }
  // 010/A02「真实之剑」：本次支付**用了置换** → 弹其技能名。
  // （攻击/抵挡/尘起 时只弹它；某技能用剑代价时 → 与那个技能名**同帧各弹一个**。）
  if (converted.length > 0) fxSkillFired(g, player, 'shenhong.sword');
  // 战术牌 T15「影子」：**使用**（攻击/抵挡/尘起支付；不含「消耗」）与存放骰同点数的能力骰后 →
  //   立即把存放骰移入"该点数对应的区域"（整局 1 次）。存放骰本身不属于任何区域。
  if (reason === 'attack' || reason === 'defense' || reason === 'dustRise') {
    const pl = g.players[player];
    const held = pl.tacticHeldDie;
    if (
      held &&
      TACTIC_BY_ID[pl.tactic ?? '']?.key === 'yingzi' &&
      !pl.tacticOnceUsed &&
      effective.some((e) => e.value === held.value)
    ) {
      const dist = pl.artifacts.find((a) => a.column === 2)?.distribution;
      if (dist) {
        pl.tacticOnceUsed = true;
        const kind = areaOf(held.value, dist);
        pl.areas[kind].push(createDie(held.id, held.value, kind));
        pl.tacticHeldDie = null;
        fxPush({ kind: 'move', player, dieIds: [held.id], fromCard: [held.id] }); // 动效：战术栏 → 中间 → 对应区
        fxTacticFired(g, player);
        const cn = kind === 'attack' ? '攻击' : kind === 'defense' ? '防御' : '冥想';
        logLine(g, `${pname(player)} 「影子」：使用 ${held.value} 点能力骰 → 存放骰移入${cn}骰区`);
      }
    }
  }
  // 「真实之剑」置换留痕（战报）
  if (converted.length > 0) {
    const kindCn = kindCnOf(converted[0].kind);
    if (converted.length === 1) {
      logLine(
        g,
        `${pname(player)} 使用「真实之剑」置换：消耗 2 颗能力骰（${converted[0].values.join('/')}）→ 视为 1 颗${kindCn}骰（点数按 5）`,
      );
    } else {
      const allVals = converted.flatMap((c) => c.values);
      logLine(
        g,
        `${pname(player)} 使用「真实之剑」置换：置换 ${converted.length} 格（另耗 ${allVals.length} 颗任意能力骰：${allVals.join('/')}）→ 视为 ${converted.length} 颗${kindCn}骰（点数按 5）`,
      );
    }
  }
  reportConsumed?.(spec.length);
  // L01 传奇面板·雨落狂流：本次「使用/消耗」若含"不符合骰点分布"的骰 → 计数 +1
  noteYuluoDiceConsumed(g, player, paidDice);
  // A06 异相·「幽魂不散」：「使用」防御/冥想骰（抵挡 reason='defense' / 尘起 reason='dustRise'）时触发；
  // 「消耗」（reason='skill'）与攻击支付（reason='attack'）不触发。
  if (reason === 'defense' || reason === 'dustRise') {
    const usedDefMed = effective.filter((e) => e.kind === 'defense' || e.kind === 'meditation').length;
    if (usedDefMed > 0) xuyuYouhunTrigger(g, player, usedDefMed);
  }
  // 026 哀歌·威压（触发）：**当持有者"使用"1 个任意能力骰后** → 弹出强制选择
  // （FAQ 26.2.1：先结算「威压」，再结算该骰的基础效果 —— 支付后立即排队，挡在后续结算之前）
  // ⚠️「使用」＝攻击支付 / 抵挡支付 / 尘起支付（关键词规则；见 AGENTS 第 22 条）；
  //    **「消耗」（技能代价，reason='skill'）不是"使用" → 不触发**（2026-09-28 用户更正，此前误含）。
  const weiyaCard = g.players[player].artifacts.find((a) => a.skills.some((s) => s.key === 'aige.weiya'));
  const weiyaSkill = weiyaCard?.skills.find((s) => s.key === 'aige.weiya');
  if (weiyaCard && weiyaSkill && skillActive(weiyaCard, weiyaSkill) && reason !== 'skill') {
    const me = g.players[player];
    const oppId: PlayerId = player === 'A' ? 'B' : 'A';
    const opp = g.players[oppId];
    const anyTarget = KINDS.some((k) => me.areas[k].length > 0 || opp.areas[k].length > 0);
    if (anyTarget) {
      g.pendingQueue.push({ kind: 'weiyaPick', player, value: weiyaSkill.value ?? 4, reason });
    }
  }
  // L04 传奇面板·无上剑术（持续）：**使用**（＝攻击支付 / 抵挡支付）**有效点数 5** 的骰 →
  //   攻击骰：回复 1 点生命／颗；防御骰：对对方造成 1 点真实伤害／颗。
  //   （010「真实之剑」置换产出的骰有效值就是 5 → 同样计入；「消耗/弃置」不触发。）
  if ((reason === 'attack' || reason === 'defense') && hasActiveSkill(g.players[player], 'tata.wushangjianshu')) {
    const five = effective.filter((e) => e.kind === reason && e.value === 5).length;
    if (five > 0) {
      fxSkillFired(g, player, 'tata.wushangjianshu');
      if (reason === 'attack') {
        const healed = heal(g, player, five);
        logLine(g, `${pname(player)} 「无上剑术」：使用 ${five} 个 5 点攻击骰 → 回复 ${healed} 点生命`);
      } else {
        const opp: PlayerId = player === 'A' ? 'B' : 'A';
        logLine(g, `${pname(player)} 「无上剑术」：使用 ${five} 个 5 点防御骰 → 对 ${pname(opp)} 造成 ${five} 点真实伤害`);
        dealTrueDamage(g, opp, five, player);
      }
    }
  }
  return effective;
}

/** 随机获得 count 颗指定类型的能力骰（点数为随机）；返回新骰 */
export function gainRandomDice(
  g: GameState,
  player: PlayerId,
  kind: DiceKind,
  count: number,
  rng: { rollDie(): number },
): Die[] {
  const out: Die[] = [];
  const p = g.players[player];
  for (let i = 0; i < count; i++) {
    const die: Die = { id: newDieId(`${player}-`), value: rng.rollDie(), kind };
    p.areas[kind].push(die);
    out.push(die);
  }
  offerAdapt(g, player, out, false); // 固定类型骰：改点保留原区域
  return out;
}

/**
 * 随机获得 count 颗**未指定类型**的能力骰：按「骰点分布」放入对应区域（规则书 §8）。
 * 骰点分布取该玩家第二列神器。
 */
export function gainRandomAbilityDice(
  g: GameState,
  player: PlayerId,
  count: number,
  rng: { rollDie(): number },
): Die[] {
  const p = g.players[player];
  const dist = p.artifacts.find((a) => a.column === 2)?.distribution;
  if (!dist) throw new Error(`player ${player} has no distribution`);
  const out: Die[] = [];
  for (let i = 0; i < count; i++) {
    const die = createDie(newDieId(`${player}-`), rng.rollDie());
    placeDieByDistribution(p.areas, die, dist);
    out.push(die);
  }
  offerAdapt(g, player, out, true); // 按分布落区：改点后需重新落区
  return out;
}

/**
 * 战术牌 T18「适应」：在"掷/获得随机骰"后提供**可选**决策——把其中 1 颗的点数改为任意 1–6（整局 1 次）。
 * `replaceByDist`＝true → 改点后按「骰点分布」**重新落区**（用于按分布落区的掷骰）；false → 保留原区域（固定类型骰）。
 * **合并多批**：同一事件内"分多次获得随机骰"（如 潜行 2 防 + 1 冥、寰宇飞升 3 攻 + 3 防、保守 1 防 + 1 冥、
 *   陷阵 另两类各 1）应合为**一个候选池**——已有未决 `shipeiPick` 时**并入**其 `dieIds`（而非丢弃），
 *   玩家可从全部骰中任选 1 颗。由各"掷骰/获得随机骰"入口调用。
 *   注：现有多批场景 `replaceByDist` 一律相同（皆为 `gainRandomDice`＝false）；若将来出现"多批且落区方式不同"，
 *   需升级为**逐骰**记录落区方式（当前仅按批取"或"，见此处 `||=`）。
 */
export function offerAdapt(g: GameState, player: PlayerId, dice: Die[], replaceByDist: boolean): void {
  if (dice.length === 0) return;
  if ((g.phase as string) === 'gameOver') return;
  const p = g.players[player];
  if (TACTIC_BY_ID[p.tactic ?? '']?.key !== 'shipei') return;
  if (p.tacticOnceUsed) return;
  const ids = dice.map((d) => d.id);
  // 已有未决的「适应」待决策（可能在 g.pending，也可能还在队列里，如 026 陷阵）→ 并入候选
  const existing =
    g.pending?.kind === 'shipeiPick'
      ? g.pending
      : g.pendingQueue.find((x) => x.kind === 'shipeiPick');
  if (existing && existing.kind === 'shipeiPick') {
    for (const id of ids) if (!existing.dieIds.includes(id)) existing.dieIds.push(id);
    existing.replaceByDist = existing.replaceByDist || replaceByDist;
    return;
  }
  queuePending(g, { kind: 'shipeiPick', player, dieIds: ids, replaceByDist });
  pumpPending(g);
}

/** 用玩家/游戏里的 rngState 执行一段需要随机数的逻辑（供引擎各处复用） */
export function withRngState<T>(g: { rngState: number }, fn: (rng: SeededRng) => T): T {
  const rng = new SeededRng(g.rngState);
  const out = fn(rng);
  g.rngState = rng.state();
  return out;
}

