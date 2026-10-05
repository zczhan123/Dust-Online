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
    };

let buf: FxEvent[] = [];

/** 每次动作开始前清空（由 `applyAction` 调用）。 */
export function fxReset(): void {
  buf = [];
}

export function fxPush(e: FxEvent): void {
  buf.push(e);
}

/** 战术效果生效：发一条 tacticFired（tacticId 取持有者当前战术牌；无则不记）。 */
export function fxTacticFired(g: GameState, player: PlayerId): void {
  const t = g.players[player].tactic;
  if (t) buf.push({ kind: 'tacticFired', player, tacticId: t });
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
    return;
  }
  const lg = p.legend;
  if (lg && lg.skills.some((s) => s.key === skillKey)) {
    const s = lg.skills.find((x) => x.key === skillKey)!;
    buf.push({ kind: 'skillFired', player, artifactId: lg.id, side: s.side, skillKey, auto: true });
  }
}

/** UI 取走并清空（每次重绘调用一次）。 */
export function fxTake(): FxEvent[] {
  const out = buf;
  buf = [];
  return out;
}
