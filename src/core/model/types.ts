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

export type Action =
  | { t: 'advance' }
  | { t: 'reroll'; dieIds: string[] }
  | { t: 'dustRise'; artifactId: string; side?: 'left' | 'right'; useSeal?: boolean; meditationDieId?: string }
  | { t: 'attack'; dieId: string }
  | { t: 'block'; dieId?: string }
  | { t: 'caiyuliu'; to: 'defense' | 'meditation' | null }
  | { t: 'fengmang'; accept: boolean; attackDieId?: string; meditationDieId?: string }
  | { t: 'guwangCharge'; dieId?: string }
  | { t: 'skill'; artifactId: string; side: 'left' | 'right' | 'only'; params?: Record<string, unknown> };

export interface PendingAttack {
  attacker: PlayerId;
  value: number;
  unblockable: boolean;
  physical: boolean;
  sourceDieId?: string;
  sourceValue?: number;
}

export type Pending =
  | { kind: 'caiyuliu'; player: PlayerId; dieId: string; value: number }
  | { kind: 'fengmang'; player: PlayerId; defenderId: PlayerId; value: number }
  | { kind: 'guwangCharge'; player: PlayerId };

export interface Distribution {
  defense: number[];
  attack: number[];
  meditation: number[];
}

export interface Buff {
  attr: 'speed' | 'will' | 'attackDamage';
  add: number;
  duration: 'thisTurn' | 'permanent';
}

export interface SkillDef {
  side: 'left' | 'right' | 'only';
  kind: 'activate' | 'continuous' | 'charge' | 'ultimate' | 'trigger';
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
  count: number;
  chargeLayer: number;
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
}
