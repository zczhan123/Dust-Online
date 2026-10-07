import type { GameState, PlayerId } from '../model/types';

/**
 * 动效「旁路事件」——引擎在关键落点记一条**只读的回执**，供 UI 编排动画顺序。
 *
 * 原则：**不影响结算**，只记录"刚发生了什么"；UI 在每次重绘时取走（`fxTake`）。
 * `applyAction` 每次开始时清空（`fxReset`），保证只保留"当前这次动作"的短暂事件。
 */

export type FxEvent =
  | { kind: 'heal'; player: PlayerId; /** 实际回复量（满血被削平 = 0 → UI 显示 +0） */ actual: number }
  | {
      kind: 'pay';
      player: PlayerId;
      /** 本次支付**全部被消耗**的骰子（真实骰 + 置换源骰 + 存放骰） */
      removedIds: string[];
      /** 其中"真实之剑置换"的配对（每组 2 个 id → 合并成 1 颗灰「5」） */
      groups: string[][];
      /** 其中**来自卡头存放骰**的 id（起点在卡头，而非区域） */
      fromCard?: string[];
    }
  | { kind: 'reroll'; player: PlayerId; /** 本次被重掷的骰子（**无论点数是否变化**，一律播"翻滚"动画） */ dieIds: string[] }
  | {
      kind: 'block';
      player: PlayerId;
      /** 本次抵挡**实际消耗**的骰子（可能是防御/冥想/攻击，或 034 存放骰） */
      dieIds: string[];
      /** 034 不动菩提·触发：本次抵挡**先停中间等 034 决定**（不立即结算）→ 界面让防御骰"并排停住" */
      park?: boolean;
    }
  | {
      /**
       * 攻击池"另一方补一颗骰"（011 灵能屏障 / 034·A03 破障）。
       * 界面把该骰飞到**已停在中间的攻击骰旁**（并排，不遮挡）：
       * - `spend`（011）：只让这颗骰消失，攻击骰留位等抵挡；
       * - `cancel`（034/A03 取消攻击/抵挡）：与攻击骰（及已在池中的抵挡骰）**一起消失**。
       */
      kind: 'attackJoin';
      player: PlayerId;
      mode: 'spend' | 'cancel';
      dieIds: string[];
      value: number;
    }
  | {
      kind: 'move';
      player: PlayerId;
      /** 本次被移动到（新）区域的骰子 */
      dieIds: string[];
      /** 其中**来自卡头存放骰**的 id（起点在卡头，而非区域） */
      fromCard?: string[];
    }
  | {
      kind: 'hanguang';
      player: PlayerId;
      /** 027 寒光·必杀：'move'＝把存放骰移入对应区；'discard'＝移除存放骰并弃置对方同点骰 */
      mode: 'move' | 'discard';
      heldId: string;
      opponentId?: string;
    }
  | {
      /**
       * 023 蛇蝎·畏惧：双方各主动消耗 1 颗骰、比大小（1 视为大于 6）。
       * 界面据此建"响应池"——发起方骰停中间等对方，对方骰到位后两颗并排一起消失。
       * `initiate`＝发起方付骰（应停在中间等）；`pay`＝被要求方付完（应并排后一起消失）。
       */
      kind: 'weiju';
      player: PlayerId;
      mode: 'initiate' | 'pay';
      /** 本次**实际消耗**的骰子（1 颗；若用 010 置换则为 2 颗源骰） */
      dieIds: string[];
      /** 用于比大小的有效点数（置换时为 5） */
      value: number;
    }
  | {
      /** 尘起"开"：把某神器的一侧推上激活（气泡「切换/激活/充能『技能名』」）。 */
      kind: 'rise';
      player: PlayerId;
      artifactId: string;
      /** 被推上的那一侧（第三列充能用 'only'） */
      side: 'left' | 'right' | 'only';
      mode: 'switch' | 'activate' | 'charge';
    }
  | {
      /** 技能"用"：某技能真正发动/触发（气泡＝技能名）。`auto`＝触发式自动。 */
      kind: 'skillFired';
      player: PlayerId;
      artifactId: string;
      side: 'left' | 'right' | 'only';
      /** 技能 key（**传奇面板**靠它精确定名——side 全是 'only'、kind 会重复，只有 key 唯一）。 */
      skillKey?: string;
      auto: boolean;
    }
  | {
      /** 战术牌效果生效（气泡＝战术名，小号，盖在「战术名＋战术药丸」上）。 */
      kind: 'tacticFired';
      player: PlayerId;
      tacticId: string;
    }
  | {
      /**
       * 真实伤害·**发动即报**（供"白墨线：发动卡图 → 受伤方生命条"）。在**落血唯一处**
       * `dealTrueDamage` 开头发一条（不管最终有没有真的扣血/被取消）。
       * `card`＝当时结算中的"发动卡"上下文（可能为 null → 界面退回"来源方面板"锚点）。
       */
      kind: 'trueLine';
      source: PlayerId;
      target: PlayerId;
      amount: number;
      card: FxSource | null;
      /** 非伤害的「生命下降」（033 抹零）：仍飞白墨线，但界面**不抖**面板（其余保留） */
      drop?: boolean;
    }
  | {
      /** 攻击骰"先别淡出、继续停在中间"（001/C01 裁雨流：命中后等玩家决定是否把攻击骰移回区域）。 */
      kind: 'holdAttackDie';
      player: PlayerId;
      dieId: string;
    }
  | {
      /** L04 重开：整盘重置（全部旧骰 → 中间合成一个 → 消失，新骰从中间冒出 → 分回各自区域）。界面据此走专用合成动画。 */
      kind: 'reset';
    }
  | {
      /** A06 勾魂：参考裁雨流——攻击骰从中间飞向该神器的标题栏（落地变灰存放骰）。`chipId`＝落地那颗存放骰的 id。 */
      kind: 'gouhun';
      player: PlayerId;
      artifactId: string;
      chipId: string;
      value: number;
    };

let buf: FxEvent[] = [];

/**
 * 「发动卡」上下文：某个技能/战术**结算期间**设置的来源卡（供真伤墨线锚点）。
 * - 技能＝`{player, artifactId, side, skillKey?}`；战术＝`{player, tacticId}`。
 * - 由各技能/战术结算处 `fxSetSource(...)` 设置；每次动作开始 `fxReset()` 清空。
 */
export type FxSource =
  | { player: PlayerId; artifactId: string; side: 'left' | 'right' | 'only'; skillKey?: string }
  | { player: PlayerId; tacticId: string };

let curSource: FxSource | null = null;

/** 记录"当前正在结算的发动卡"（各技能/战术结算处设置；`fxReset` 清空）。 */
export function fxSetSource(s: FxSource | null): void {
  curSource = s;
}

/** 每次动作开始前清空（由 `applyAction` 调用）。 */
export function fxReset(): void {
  buf = [];
  curSource = null;
}

/** 真实伤害·发动即报：记录"从哪张发动卡、打到谁"。`card` 取当前结算中的发动卡（无则 UI 退回来源面板）。 */
export function fxTrueLine(source: PlayerId, target: PlayerId, amount: number, drop = false): void {
  buf.push({ kind: 'trueLine', source, target, amount, card: curSource, ...(drop ? { drop: true } : {}) });
}

export function fxPush(e: FxEvent): void {
  buf.push(e);
}

/** 战术效果生效：发一条 tacticFired（tacticId 取持有者当前战术牌；无则不记）。 */
export function fxTacticFired(g: GameState, player: PlayerId): void {
  const t = g.players[player].tactic;
  if (t) {
    buf.push({ kind: 'tacticFired', player, tacticId: t });
    curSource = { player, tacticId: t }; // 兼作真伤白墨线锚点（紧接着的 dealTrueDamage 取它）
  }
}

/**
 * 技能"用/触发"气泡：按 skillKey 反查持有人（**神器或传奇面板**）→ 发 `skillFired{auto:true}`。
 * 用于"持续/强制效果被动生效"与"触发式技能玩家真的发动"这类没有 artifactId 上下文的地方。
 */
export function fxSkillFired(g: GameState, player: PlayerId, skillKey: string): void {
  const p = g.players[player];
  const a = p.artifacts.find((x) => x.skills.some((s) => s.key === skillKey));
  if (a) {
    const s = a.skills.find((x) => x.key === skillKey)!;
    buf.push({ kind: 'skillFired', player, artifactId: a.id, side: s.side, skillKey, auto: true });
    curSource = { player, artifactId: a.id, side: s.side, skillKey }; // 兼作真伤白墨线锚点
    return;
  }
  const lg = p.legend;
  if (lg && lg.skills.some((s) => s.key === skillKey)) {
    const s = lg.skills.find((x) => x.key === skillKey)!;
    buf.push({ kind: 'skillFired', player, artifactId: lg.id, side: s.side, skillKey, auto: true });
    curSource = { player, artifactId: lg.id, side: s.side, skillKey }; // 兼作真伤白墨线锚点
  }
}

/** UI 取走并清空（每次重绘调用一次）。 */
export function fxTake(): FxEvent[] {
  const out = buf;
  buf = [];
  return out;
}
