import { describe, it, expect } from 'vitest';
import { createGame, applyAction, skipInitialReroll, getLegalActions } from '../src/core/engine/game';
import { canPayCosts, defaultCostFills, abilityDicePool } from '../src/core/engine/effects';
import { SKILL_SELECTION } from '../src/ui/skillSelection';
import type { Action, DiceKind, GameState, PlayerId } from '../src/core/model/types';

/**
 * 「使用/消耗」的支付来源：010/A02「真实之剑」置换 + 034/A03 破障的存放骰。
 * 回归用户报告：真实之剑 + 龙腾万丈 + 2 冥想 + 5 其它 → 引擎应给出「龙腾万丈」按钮。
 */
const mk = (heroA: [string, string, string]): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA, heroB: ['004', '005', '006'] });
  skipInitialReroll(g);
  g.phase = 'main';
  g.pending = null;
  g.pendingAttack = null;
  g.skillsUsedThisTurn = [];
  return g;
};
const art = (g: GameState, who: PlayerId, id: string) => g.players[who].artifacts.find((a) => a.id === id)!;
const arm = (g: GameState, who: PlayerId, id: string, side: 'left' | 'right'): void => {
  const a = art(g, who, id);
  a.activeMarkerSide = side;
  a.armedSide = side;
  a.armedTurn = g.turnIndex;
};
const dice = (prefix: string, kind: DiceKind, values: number[]) =>
  values.map((v, i) => ({ id: `${prefix}${i}`, value: v, kind }));
const hasSkill = (g: GameState, artifactId: string, side: 'left' | 'right'): boolean =>
  getLegalActions(g).some((a) => a.t === 'skill' && a.artifactId === artifactId && a.side === side);
const skillAct = (g: GameState, artifactId: string, side: 'left' | 'right') =>
  getLegalActions(g).find(
    (a): a is Extract<Action, { t: 'skill' }> => a.t === 'skill' && a.artifactId === artifactId && a.side === side,
  )!;

describe('支付来源：真实之剑置换 / 破除存放骰（门槛与默认参数）', () => {
  it('用户例子：真实之剑 + 龙腾万丈 + 2 冥想 + 5 其它 → 出现「龙腾万丈」按钮且能发动', () => {
    const g = mk(['010', '002', '003']); // 010=真实之剑(第一列)；002=龙腾万丈(第二列)
    arm(g, 'A', '010', 'left');
    arm(g, 'A', '002', 'right');
    g.players.A.areas.meditation = dice('m', 'meditation', [2, 5]);
    g.players.A.areas.attack = dice('a', 'attack', [1, 3, 4]);
    g.players.A.areas.defense = dice('d', 'defense', [1, 6]);

    expect(hasSkill(g, '002', 'right')).toBe(true);
    const act = skillAct(g, '002', 'right');
    // 2 颗真冥想 + 1 格置换（2 颗任意）→ 3 格
    expect(act.params?.costSlots).toHaveLength(3);
    expect((act.params?.costSlots as { dieIds: string[] }[]).filter((f) => f.dieIds.length === 2)).toHaveLength(1);

    applyAction(g, act);
    // 龙腾万丈：消耗 3 冥想 → 获得 4 随机能力骰；2 颗真 + 2 颗置换被消耗
    expect(g.players.A.areas.meditation).toHaveLength(0);
  });

  it('负例：未激活真实之剑时，2 冥想不足 → 不出现「龙腾万丈」按钮', () => {
    const g = mk(['010', '002', '003']);
    arm(g, 'A', '002', 'right'); // 只激活龙腾，010 未激活
    g.players.A.areas.meditation = dice('m', 'meditation', [2, 5]);
    g.players.A.areas.attack = dice('a', 'attack', [1, 3, 4]);
    g.players.A.areas.defense = dice('d', 'defense', [1, 6]);
    expect(hasSkill(g, '002', 'right')).toBe(false);
  });

  it('034 破障：神器存放骰可满足「消耗 1–3 攻击骰」（灵能脉冲，无区域攻击骰）', () => {
    const g = mk(['034', '011', '003']); // 034=破障(第一列)；011=灵能脉冲(第二列，分布 攻2/4)
    arm(g, 'A', '034', 'left');
    arm(g, 'A', '011', 'right');
    g.players.A.areas = { attack: [], defense: [], meditation: [] };
    art(g, 'A', '034').heldDice = [
      { id: 'hA1', value: 2 },
      { id: 'hA2', value: 4 },
    ]; // 011 分布：攻=2/4 → 均视为攻击骰

    expect(hasSkill(g, '011', 'right')).toBe(true);
    applyAction(g, skillAct(g, '011', 'right'));
    expect(art(g, 'A', '034').heldDice).toHaveLength(0); // 存放骰已被消耗
  });

  it('canPayCosts / defaultCostFills：含置换的可行性 = T − N ≥ 缺口', () => {
    const g = mk(['010', '002', '003']);
    arm(g, 'A', '010', 'left');
    g.players.A.areas.meditation = dice('m', 'meditation', [2, 5]);
    g.players.A.areas.attack = dice('a', 'attack', [1, 3, 4]);
    g.players.A.areas.defense = dice('d', 'defense', [1, 6]);
    expect(canPayCosts(g, 'A', { meditation: 3 }, { held: true })).toBe(true);
    expect(canPayCosts(g, 'A', { meditation: 5 }, { held: true })).toBe(false); // 7 − 5 = 2 < 缺口 3
    const fills = defaultCostFills(g, 'A', { meditation: 3 }, { held: true });
    expect(fills).toHaveLength(3);
    expect(fills.filter((f) => f.dieIds.length === 2)).toHaveLength(1);

    // 未激活真实之剑 → 不能靠置换
    const g2 = mk(['010', '002', '003']);
    g2.players.A.areas.meditation = dice('m', 'meditation', [2, 5]);
    g2.players.A.areas.attack = dice('a', 'attack', [1, 3, 4]);
    g2.players.A.areas.defense = dice('d', 'defense', [1, 6]);
    expect(canPayCosts(g2, 'A', { meditation: 3 }, { held: true })).toBe(false);
  });

  it('规则③ 035 超度：无同点对时，可用置换（点数 5）凑「两颗相同」', () => {
    const g = mk(['010', '035', '003']); // 010 第一列；035 第二列（超度）
    arm(g, 'A', '010', 'left');
    arm(g, 'A', '035', 'right');
    g.players.A.areas.meditation = dice('m', 'meditation', [5]);
    g.players.A.areas.attack = dice('a', 'attack', [1, 3]);
    g.players.A.areas.defense = dice('d', 'defense', [1]);

    expect(hasSkill(g, '035', 'right')).toBe(true);
    const act = skillAct(g, '035', 'right');
    const slots = act.params?.costSlots as { dieIds: string[] }[];
    expect(slots).toHaveLength(2);
    // 一颗真 5 + 一颗置换（2 颗任意，视为 5）→ 两颗均 5 → 满足「点数相同」
    expect(slots.some((s) => s.dieIds.length === 2)).toBe(true);
    applyAction(g, act);
  });

  it('abilityDicePool：破障生效时把存放骰按第二列分布计入（类型判定）', () => {
    const g = mk(['034', '011', '003']);
    arm(g, 'A', '034', 'left');
    g.players.A.areas = { attack: [], defense: [], meditation: [] };
    art(g, 'A', '034').heldDice = [
      { id: 'h1', value: 1 }, // 011 分布：防=1/6
      { id: 'h2', value: 2 }, // 攻=2/4
      { id: 'h3', value: 3 }, // 冥=3/5
    ];
    const pool = abilityDicePool(g, 'A');
    expect(pool.find((d) => d.id === 'h1')?.kind).toBe('defense');
    expect(pool.find((d) => d.id === 'h2')?.kind).toBe('attack');
    expect(pool.find((d) => d.id === 'h3')?.kind).toBe('meditation');
  });
});

/**
 * 单类型交互回归：锁定现有三种单类型交互形态，防止将来"多类型 UX 统一"改动误伤共用代码。
 * 关键：`slots` 面板被**单类型**（003 突破 / 035 超度，持 010 时）与多类型（007 横扫）**共用**。
 */
describe('单类型交互回归（防未来多类型改动误伤）', () => {
  const stepsOf = (g: GameState, key: string) =>
    SKILL_SELECTION[key].steps({ state: g, player: 'A', chosenDice: [], options: [], numbers: [], slots: [] });

  it('龙腾万丈（第二列）：持 010 → 新交互「选真骰 → 选置换源」；无 010 → 单个 dice 步（恰好 3 颗）', () => {
    const g1 = mk(['010', '002', '003']);
    arm(g1, 'A', '010', 'left'); // 真实之剑
    const s1 = stepsOf(g1, 'youlong.tengwan');
    expect(s1.map((s) => s.kind)).toEqual(['dice', 'dice']); // 新交互：选真骰 →（不足）选置换源
    const d1 = s1[0];
    expect(d1.kind === 'dice' ? d1.areas : null).toEqual(['meditation']);
    expect(d1.kind === 'dice' ? d1.allowArtifact : null).toBe(true);
    expect(d1.kind === 'dice' ? d1.max : null).toBe(3); // 点几颗＝几格（最多 3）

    // 选过若干真骰后：第二步恰好补 2×(3−真骰数) 颗任意骰（每 2 颗＝1 组置换）
    const medIds = g1.players.A.areas.meditation.map((d) => d.id).slice(0, 2);
    const s1b = SKILL_SELECTION['youlong.tengwan'].steps({
      state: g1,
      player: 'A',
      chosenDice: [medIds],
      options: [],
      numbers: [],
      slots: [],
    });
    expect(s1b.map((s) => s.kind)).toEqual(['dice', 'dice']);
    const sub = s1b[1];
    expect(sub.kind === 'dice' ? sub.min : null).toBe((3 - medIds.length) * 2);
    expect(sub.kind === 'dice' ? sub.max : null).toBe((3 - medIds.length) * 2);

    const g2 = mk(['010', '002', '003']); // 未激活 010
    const s2 = stepsOf(g2, 'youlong.tengwan');
    expect(s2.map((s) => s.kind)).toEqual(['dice']);
    const d2 = s2[0];
    expect(d2.kind === 'dice' ? d2.areas : null).toEqual(['meditation']);
    expect(d2.kind === 'dice' ? d2.min : null).toBe(3);
  });

  it('突破（第三列）/ 超度（第二列）：持 010 → slots 步；无 010 → dice 步', () => {
    const g1 = mk(['010', '035', '003']);
    arm(g1, 'A', '010', 'left');
    expect(stepsOf(g1, 'yuqie.breakthrough')[0].kind).toBe('slots');
    expect(stepsOf(g1, 'qianjie.chaodu')[0].kind).toBe('slots');

    const g2 = mk(['010', '035', '003']);
    expect(stepsOf(g2, 'yuqie.breakthrough')[0].kind).toBe('dice');
    expect(stepsOf(g2, 'qianjie.chaodu')[0].kind).toBe('dice');
  });
});
