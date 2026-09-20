export type PlayerId = 'A' | 'B';
export type DiceKind = 'attack' | 'defense' | 'meditation';
export type Column = 1 | 2 | 3;
export type Phase =
  | 'setup'
  | 'initialReroll'
  | 'refill'
  | 'reroll'
  | 'dustRise'
  | 'main'
  | 'end'
  | 'gameOver';

export interface Die {
  id: string;
  value: number; // 1..6
  kind: DiceKind;
}

export interface SlotSpec {
  kind: DiceKind;
}

export interface SlotFill {
  dieIds: string[];
  /** 该格用「视为」填补（单骰跨类型，需技能许可，如 025「奇袭」）：仅当类型不匹配时使用 */
  treated?: boolean;
}

export interface EffectiveDie {
  kind: DiceKind;
  value: number;
  source: 'real' | 'converted' | 'treated';
  realIds: string[];
}

export type Action =
  | { t: 'advance' }
  | { t: 'reroll'; dieIds: string[] }
  | { t: 'dustRise'; artifactId: string; side?: 'left' | 'right'; useSeal?: boolean; free?: boolean; costSlots?: SlotFill[] }
  | { t: 'attack'; costSlots: SlotFill[] }
  | { t: 'block'; costSlots?: SlotFill[] }
  | { t: 'caiyuliu'; to: 'defense' | 'meditation' | null }
  | { t: 'fengmang'; accept: boolean; attackDieId?: string; meditationDieId?: string }
  | { t: 'guwangCharge'; dieId?: string }
  | { t: 'guwangCancel'; cancel: boolean; defenseDieId?: string }
  | { t: 'shenhongKill'; accept: boolean }
  | { t: 'dunwuHalve'; accept: boolean; meditationDieId?: string }
  | { t: 'dunwuPulse'; accept: boolean }
  | { t: 'leibaoReroll'; accept: boolean }
  | { t: 'dianxing'; accept?: false; dieIds?: string[] }
  | { t: 'leibao'; accept?: false; dieIds?: string[] }
  | { t: 'weimu'; accept: boolean; dieId?: string }
  | { t: 'zhihaiReroll'; dieIds: string[] }
  /** 019 尘哀·尘起：是否接受赠送的 1 次「无需冥想骰的额外尘起行动」 */
  | { t: 'chenaiFreeRise'; accept: boolean }
  /** 022 死契·处刑通牒：使用攻击骰前的强制决定（不发动 / ①伤害+1且不可抵挡 / ②伤害+5） */
  | { t: 'chuxingPick'; pick: 'none' | 'unblockable' | 'bonus5' }
  /** 023 蛇蝎·畏惧：对方被迫消耗他选择的那颗能力骰 */
  | { t: 'weijuPay'; dieId: string }
  /** 023 蛇蝎·共振：选择 ①双方各得 2 颗 / ②双方各弃置 2 颗（弃置由发起者指定） */
  | { t: 'gongzhenResolve'; pick: 'gain' | 'discard'; myIds?: string[]; oppIds?: string[] }
  /** 020 兽魂：攻击方选择是否取消本次伤害（取消则令持有者计数 −1） */
  | { t: 'shouhunCancel'; cancel: boolean }
  /** 026 哀歌·威压：使用能力骰后，令自己或对方的 1 颗能力骰点数变为固定值（保留区域）；dieId 省略 = 不发动 */
  | { t: 'weiyaPick'; owner: 'self' | 'opp'; dieId?: string }
  /** 026 哀歌·陷阵：生命最少的一方选择弃置持有者的 1 颗能力骰 */
  | { t: 'xianzhenResolve'; dieId: string }
  /** 025 屠虎·横贯（触发）：被抵挡后可弃置对方 1 颗点数小于该攻击的能力骰；dieId 省略 = 不发动 */
  | { t: 'hengguan'; dieId?: string }
  /** 027 寒光·必杀：使用攻击骰前的二选一（① 把神器上的骰移入对应区域 / ② 移除它并弃置对方同点数骰） */
  | { t: 'hanguangPick'; pick: 'move' | 'discard'; dieId: string; targetDieId?: string }
  | { t: 'skill'; artifactId: string; side: 'left' | 'right' | 'only'; params?: Record<string, unknown> };

export interface PendingAttack {
  attacker: PlayerId;
  value: number;
  unblockable: boolean;
  physical: boolean;
  sourceDieId?: string;
  sourceValue?: number;
  /** 攻击的有效点数（物理=骰点；技能发起的攻击=该技能指定的点数）。供 017 持续判定，不受伤害加成影响 */
  baseValue?: number;
  /** 本次伤害是否已被「减半」（同种削减不叠加：屏障 / 021 满计数 / 023 畏惧 只减半一次） */
  halved?: boolean;
  /** 本次攻击实际应用的伤害加成值（含 022 处刑通牒这类单次修正），供提示栏显示 */
  bonusValue?: number;
  /** 上述加成的来源名（如「处刑通牒」） */
  bonusLabel?: string;
  /** 减半来源名（如「畏惧」），供提示栏显示 */
  halveReason?: string;
}

export type Pending =
  | { kind: 'caiyuliu'; player: PlayerId; dieId: string; value: number }
  | { kind: 'fengmang'; player: PlayerId; defenderId: PlayerId; value: number }
  | { kind: 'guwangCharge'; player: PlayerId }
  | { kind: 'guwangCancel'; player: PlayerId; amount: number }
  | { kind: 'shenhongKill'; player: PlayerId }
  | { kind: 'dunwuHalve'; player: PlayerId }
  | { kind: 'dunwuPulse'; player: PlayerId; amount: number }
  | { kind: 'leibaoReroll'; player: PlayerId }
  | { kind: 'dianxing'; player: PlayerId }
  | { kind: 'leibao'; player: PlayerId }
  /** 「激活」类技能：尘起装填到该侧后立即强制结算（待玩家选完） */
  | { kind: 'activationResolve'; player: PlayerId; artifactId: string; side: 'left' | 'right' | 'only' }
  /** 017 帷幕：对方重掷阶段结束时，可受 2 真实伤害并弃置对方 1 个能力骰 */
  | { kind: 'weimu'; player: PlayerId }
  /** 018 漆黑绽放·必杀：获得 X 骰后，可选重掷最多 X 颗 */
  | { kind: 'zhihaiReroll'; player: PlayerId; x: number; forced: boolean }
  /** 019 尘哀·尘起：自己回合造成伤害后可立即进行 1 次「无需冥想骰」的额外尘起行动（每回合 1 次） */
  | { kind: 'chenaiFreeRise'; player: PlayerId }
  /** 020 兽魂：攻击方选择「取消本次伤害（持有者计数 −1）」还是「正常造成伤害」 */
  | { kind: 'shouhunCancel'; player: PlayerId; owner: PlayerId; attack: PendingAttack }
  /** 022 死契·处刑通牒：使用攻击骰前必须先决定是否扣计数（FAQ 22.2.1） */
  | { kind: 'sijiChuxing'; player: PlayerId; costSlots: SlotFill[] }
  /** 023 蛇蝎·畏惧：对方必须消耗 1 颗能力骰（由对方选择） */
  | { kind: 'weijuPay'; player: PlayerId; initiator: PlayerId; initiatorValue: number }
  /** 023 蛇蝎·共振：重掷并落区后，按落区类型二选一 */
  | { kind: 'gongzhenPick'; player: PlayerId; areaKind: DiceKind }
  /** 第三列「充能」技能需要玩家选择（024 狂舞）时，装填后强制结算 */
  | { kind: 'chargeResolve'; player: PlayerId; artifactId: string }
  /** 026 哀歌·威压：某人「使用 1 个任意能力骰后」，威压持有者可令 1 颗能力骰点数变为固定值（FAQ 26.2.1：先于该骰的基础效果结算） */
  | { kind: 'weiyaPick'; player: PlayerId; value: number }
  /** 026 哀歌·陷阵：持有者的重掷阶段结束时，由生命最少的一方（并列 = 当前回合玩家）弃置持有者 1 颗能力骰 */
  | { kind: 'xianzhenPick'; player: PlayerId; owner: PlayerId }
  /** 025 屠虎·横贯（触发）：攻击被抵挡后，攻击者可弃置对方 1 颗点数小于该攻击的能力骰 */
  | { kind: 'hengguan'; player: PlayerId; value: number }
  /** 027 寒光·必杀：使用攻击骰前，必须先决定是否使用神器上的骰子（暂存本次攻击的支付） */
  | { kind: 'hanguangPick'; player: PlayerId; costSlots: SlotFill[] };

export interface Distribution {
  defense: number[];
  attack: number[];
  meditation: number[];
}

export interface Buff {
  attr: 'speed' | 'will' | 'attackDamage';
  add: number;
  duration: 'thisTurn' | 'permanent';
  /** 显示用来源（技能名），仅用于文案；未填则文案只显示数值 */
  source?: string;
}

export interface SkillDef {
  side: 'left' | 'right' | 'only';
  /** continuous=持续 trigger=触发 activate=启动 charge=充能 ultimate=必杀 activation=激活（装填到该侧即立即强制结算） */
  kind: 'activate' | 'activation' | 'continuous' | 'charge' | 'ultimate' | 'trigger';
  key: string;
  /** 启动后刷新自身「每回合一次」计数（019 蛮王之牙） */
  refresh?: boolean;
  /** 该「充能」技能需要玩家选择（024 狂舞）：充能后弹出强制选择器，而不是自动结算 */
  needsChoice?: boolean;
  /** 卡面固定数值（如 026「威压」把点数变为 4、027 等）：供处理器/待决策读取，避免硬编码 */
  value?: number;
}

export interface Artifact {
  id: string;      // '001'
  name: string;    // '雨切'
  weapon?: string; // '武士刀'（武器类型，用于显示）
  column: Column;
  speed?: number;
  will?: number;
  distribution?: Distribution;
  life?: number;
  chargeReq?: number;
  activeMarkerSide: 'left' | 'right' | null;
  /** 本回合被“激活/切入”的侧（供「激活」类技能判定：只在切入当回合可用） */
  armedSide: 'left' | 'right' | null;
  /** 执行上述切入时的回合号（与 GameState.turnIndex 比较） */
  armedTurn: number;
  count: number;
  /** 本神器计数的上限（卡面 `计数 N/上限` 与续充判定用；未填 = 不显示上限） */
  countCap?: number;
  /** 第三列神器：完成充能（已激活）后仍可被尘起选中继续充能（021 决意「续充」） */
  chargeExtend?: boolean;
  chargeLayer: number;
  /** 「在接下来的游戏中，本神器失去持续式效果」（018 必杀等） */
  continuousLost?: boolean;
  /** 置于本神器上的骰子（027 寒光·必杀：1–6 点各 1 颗；回合结束时清空）。这些骰不在任何区域，落区时按点数决定类型 */
  heldDice?: { id: string; value: number }[];
  skills: SkillDef[];
}

export interface PlayerState {
  id: PlayerId;
  areas: Record<DiceKind, Die[]>;
  artifacts: Artifact[];
  life: number;
  lifeMax: number;
  markers: number;
  hasDustSeal: boolean;
  buffs: Buff[];
  /** 本回合是否已受过伤害（018 至黑：每回合第一次受伤才计数） */
  damagedThisTurn: boolean;
  /** 023 蛇蝎·畏惧：该玩家「下个回合」中攻击造成的伤害减半（其回合结束时清除） */
  attackHalvedNextTurn: boolean;
}

export interface LogEntry {
  turn: number;
  phase: Phase;
  text: string;
}

export interface GameState {
  players: Record<PlayerId, PlayerState>;
  activePlayer: PlayerId;
  firstPlayer: PlayerId;
  initialRerollQueue: PlayerId[];
  phase: Phase;
  dustfall: number;
  turnIndex: number;
  firstRound: Record<PlayerId, boolean>;
  rngState: number;
  log: LogEntry[];
  pendingAttack: PendingAttack | null;
  pending: Pending | null;
  unblockableThisTurn: boolean;
  caiyuliuUsed: number;
  dustRiseNormalUsed: boolean;
  dustRiseActed: boolean;
  freeDustRise: number;
  rerollUsed: number;
  skillsUsedThisTurn: string[];
  ultimatesUsed: string[];
  winner: PlayerId | null;
  skillConsumedThisAction: number;
  dunwuPulseUsedThisTurn: boolean;
  /** 多段攻击队列（013 电刑：1/2/3 逐段结算） */
  attackQueue: { player: PlayerId; values: number[] } | null;
  /** 额外重掷阶段（013 雷暴·持续：在对方重掷阶段结束时插入） */
  extraReroll: { player: PlayerId; resume: PlayerId } | null;
  /** 待弹出的待决策队列（多个触发同时排队时按序弹出，避免互相覆盖） */
  pendingQueue: Pending[];
  /** 019 尘哀·尘起：本回合该玩家是否已触发过（每回合最多 1 次） */
  chenaiUsed: Record<PlayerId, boolean>;
  /** 本回合可用的「无需冥想骰的额外尘起行动」次数（019 尘起赠予） */
  freeNoCostRise: number;
  /** 每名玩家「本回合已进行的攻击次数」（025 屠虎·横贯持续：第 2 次攻击伤害 +2；回合开始时清零） */
  attacksThisTurn: Record<PlayerId, number>;
  /** 027 寒光·凛冽之音（充能）：持有者自己的下个尘起阶段开始前，任何玩家重掷能力骰都会受到等量真实伤害 */
  rerollPunish: Record<PlayerId, boolean>;
}
