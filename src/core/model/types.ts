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
}

export interface EffectiveDie {
  kind: DiceKind;
  value: number;
  source: 'real' | 'converted';
  realIds: string[];
}

export type Action =
  | { t: 'advance' }
  | { t: 'reroll'; dieIds: string[] }
  | { t: 'dustRise'; artifactId: string; side?: 'left' | 'right'; useSeal?: boolean; costSlots?: SlotFill[] }
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
  | { kind: 'zhihaiReroll'; player: PlayerId; x: number; forced: boolean };

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
  /** continuous=持续 trigger=触发 activate=启动 charge=充能 ultimate=必杀 activation=激活（仅在“切入该侧”的当回合可用一次） */
  kind: 'activate' | 'activation' | 'continuous' | 'charge' | 'ultimate' | 'trigger';
  key: string;
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
  chargeLayer: number;
  /** 「在接下来的游戏中，本神器失去持续式效果」（018 必杀等） */
  continuousLost?: boolean;
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
}
