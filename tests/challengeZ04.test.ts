import { describe, it, expect } from 'vitest';
import {
  createChallengeGame,
  applyChallengeSkill,
  applyAction,
  skipInitialReroll,
  legendAssignNeeded,
  legendAssignAuto,
  resolveLegendDeferred,
} from '../src/core/engine/game';
import { CHALLENGES } from '../src/core/content/challenges';
import type { Die, DiceKind, GameState } from '../src/core/model/types';

const die = (id: string, value: number, kind: DiceKind = 'meditation'): Die => ({ id, value, kind });
const Z04 = CHALLENGES.find((c) => c.id === 'Z04')!;
const SK = (id: string) => Z04.skills!.find((s) => s.id === id)!;
const make = (mode: 'manual' | 'favor' | 'against' = 'manual') =>
  createChallengeGame({ seed: 1, cardId: 'Z04', challenger: ['001', '002', '003'], settleMode: mode });
const setA = (g: GameState, areas: { attack?: Die[]; defense?: Die[]; meditation?: Die[] }): void => {
  g.players.A.areas.attack = areas.attack ?? [];
  g.players.A.areas.defense = areas.defense ?? [];
  g.players.A.areas.meditation = areas.meditation ?? [];
};
const vals = (ds: Die[]) => ds.map((d) => d.value);

describe('挑战模式 · Z04 地狱的魔女 · 数据', () => {
  it('生命 40 / 门槛 5 / 投 10 驱动骰 / 无上限 / 6 条技能', () => {
    expect(Z04.life).toBe(40);
    expect(Z04.defenseMin).toBe(5);
    expect(Z04.rollDice).toBe(10);
    expect(Z04.defenseCap).toBeUndefined();
    expect(Z04.skills).toHaveLength(6);
    expect(Z04.skills![2].slots).toEqual([{ kind: 'same', count: 4 }]);
    expect(Z04.skills![3].slots).toEqual([{ kind: 'straight', count: 4 }]);
  });
});

describe('挑战模式 · Z04 效果', () => {
  it('真实之剑：防御骰 > 10 → 这批判防御骰从**防御区**逐个飞出攻击（甲：不搬进攻击区）；≤10 → 无效果', () => {
    const g = make();
    setA(g, {});
    g.players.B.areas.defense = [1, 2, 3, 4, 5, 6, 1, 2, 3, 4].map((v, i) => die(`bd${i}`, v, 'defense'));
    applyChallengeSkill(g, Z04, SK('z04-1'), []);
    expect(g.players.B.areas.defense).toHaveLength(10); // 恰好 10 → 不触发
    expect(g.pendingAttack).toBeNull();

    g.players.B.areas.defense.push(die('bd10', 5, 'defense')); // 11 个
    g.players.B.areas.attack = [die('xa', 3, 'attack'), die('xb', 4, 'attack')]; // 攻击骰区**原有干扰骰**
    const res = applyChallengeSkill(g, Z04, SK('z04-1'), []);
    // 甲：这批判防御骰**留在防御骰区**（不搬、`kind` 不变）；攻击骰区**原封不动**
    expect(g.players.B.areas.defense).toHaveLength(11);
    expect(g.players.B.areas.defense.every((d) => d.kind === 'defense')).toBe(true);
    expect(vals(g.players.B.areas.attack)).toEqual([3, 4]); // 原骰不动、不参与
    expect(g.pendingAttack).toMatchObject({ attacker: 'B' });
    // 队列＝11 颗（1 发出 + 10 待），且**只含防御区的 bd***（不含攻击区原有 2 颗）
    const queued = [g.pendingAttack?.sourceDieId, ...(g.virtualQueue ?? []).map((q) => q.dieId)];
    expect(queued).toHaveLength(11);
    expect(queued.every((id) => (id ?? '').startsWith('bd'))).toBe(true);
    // 不播"防御区→攻击区"进入动画（`spawn` 空）；攻击骰带 `sourceDieId`+`solid` → 从**防御骰区**旧位飞出
    expect(res.spawn).toEqual([]);
    expect(g.pendingAttack?.sourceDieId).toBeTruthy();
    expect(g.pendingAttack?.dieStyle).toBe('solid');
  });

  it('真实之剑（甲）：打完一颗 → 从**防御骰区**移除（防御骰区 −1）', () => {
    const g = make();
    setA(g, {});
    g.players.B.areas.defense = [1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 6].map((v, i) => die(`bd${i}`, v, 'defense'));
    g.players.B.areas.attack = [];
    applyChallengeSkill(g, Z04, SK('z04-1'), []);
    const src = g.pendingAttack!.sourceDieId!;
    expect(g.players.B.areas.defense.some((d) => d.id === src)).toBe(true);
    applyAction(g, { t: 'block' }); // 挑战者不抵挡 → 这一击结算完
    expect(g.players.B.areas.defense.some((d) => d.id === src)).toBe(false); // 已从防御骰区移除
  });

  it('梦醒时分：挑战者计数/充能归零；魔女生命回复至 40', () => {
    const g = make();
    g.players.A.artifacts[0].count = 3;
    g.players.A.artifacts[1].chargeLayer = 2;
    g.players.B.life = 12;
    applyChallengeSkill(g, Z04, SK('z04-2'), []);
    expect(g.players.A.artifacts.every((a) => (a.count ?? 0) === 0 && (a.chargeLayer ?? 0) === 0)).toBe(true);
    expect(g.players.B.life).toBe(40);
  });

  it('顿悟：所有区域能力骰数量翻倍（新增随机骰）', () => {
    const g = make();
    g.players.B.areas.attack = [die('b1', 2, 'attack'), die('b2', 3, 'attack')];
    g.players.B.areas.defense = [die('b3', 4, 'defense')];
    applyChallengeSkill(g, Z04, SK('z04-3'), []);
    expect(g.players.B.areas.attack).toHaveLength(4);
    expect(g.players.B.areas.defense).toHaveLength(2);
  });

  it('无上剑术：先把最高点数的驱动骰移入攻击区（本步不攻击），顺序定好后逐个攻击', () => {
    const g = make();
    setA(g, {});
    g.players.B.areas.attack = [];
    g.challenge!.driven = [die('d1', 5), die('d2', 5), die('d3', 1)];
    applyChallengeSkill(g, Z04, SK('z04-4'), []);
    // ① 移入攻击骰区（**本步不发起攻击** → 回归：骰子必须先到攻击区、再问顺序）
    expect(vals(g.players.B.areas.attack)).toEqual([5, 5]);
    expect(vals(g.challenge!.driven)).toEqual([1]);
    expect(g.challenge!.deferred).toMatchObject({ skillId: 'z04-4' });
    expect(g.pendingAttack).toBeNull();
    expect(g.virtualQueue ?? []).toHaveLength(0);
    // ② 顺序已在 deferred 阶段定好 → 逐个攻击（先发起 1 颗 5 点）
    g.challenge!.decisions = { 'z04-4': ['asc'] };
    resolveLegendDeferred(g, Z04);
    expect(g.pendingAttack).toMatchObject({ attacker: 'B', baseValue: 5 });
  });

  it('无上剑术·自选：>1 颗时在 deferred 阶段弹顺序面板（移入之后才问）', () => {
    const g = make('manual');
    setA(g, {});
    g.players.B.areas.attack = [];
    g.challenge!.driven = [die('d1', 5), die('d2', 5)];
    applyChallengeSkill(g, Z04, SK('z04-4'), []);
    expect(g.players.B.areas.attack).toHaveLength(2); // 已移入
    expect(g.pendingAttack).toBeNull();
    resolveLegendDeferred(g, Z04);
    expect(g.pending?.kind).toBe('challengePick');
    if (g.pending?.kind !== 'challengePick') throw new Error('expect challengePick');
    expect(g.pending.options.map((o) => o.id)).toEqual(['asc', 'desc']);
  });

  it('无上剑术：攻击骰数 ≤ 挑战者防御骰数 → 不攻击', () => {
    const g = make();
    setA(g, { defense: [die('p1', 2, 'defense'), die('p2', 2, 'defense'), die('p3', 2, 'defense')] });
    g.players.B.areas.attack = [];
    g.challenge!.driven = [die('d1', 5), die('d2', 5)];
    applyChallengeSkill(g, Z04, SK('z04-4'), []);
    expect(g.players.B.areas.attack).toHaveLength(2);
    resolveLegendDeferred(g, Z04);
    expect(g.pendingAttack).toBeNull();
    expect(g.challenge!.deferred).toBeUndefined();
  });

  it('灵能屏障：把剩余驱动骰中数量最多的点数的骰移入防御区', () => {
    const g = make();
    g.players.B.areas.defense = [];
    g.challenge!.driven = [die('d1', 3), die('d2', 3), die('d3', 3), die('d4', 6)];
    applyChallengeSkill(g, Z04, SK('z04-5'), []);
    expect(vals(g.players.B.areas.defense)).toEqual([3, 3, 3]);
    expect(vals(g.challenge!.driven)).toEqual([6]);
  });

  it('灵能屏障·并列：两个点数同为最多 → 代决（自选弹面板；有利＝取点数小）', () => {
    // 自选：并列 → 弹 challengePick（options＝并列点数）
    const g = make();
    skipInitialReroll(g);
    g.phase = 'main';
    g.activePlayer = 'B';
    g.challenge!.turn = 2;
    g.challenge!.resumeAt = 5; // z04-5 灵能屏障
    g.challenge!.driven = [die('d1', 2), die('d2', 2), die('d5', 5), die('d6', 5)];
    g.players.B.areas.defense = [];
    g.pending = null; // 清掉 `skipInitialReroll` 引发的 D1「开局选骰」代决（本测试只驱动 z04-5）
    applyAction(g, { t: 'challengeStep' });
    const pd = g.pending as { kind?: string; options?: { id: string }[] } | null;
    expect(pd?.kind).toBe('challengePick');
    expect(pd!.options!.map((o) => o.id)).toEqual(['2', '5']);

    // 有利：自动取点数小（2）→ 移入 2、2
    const g2 = make('favor');
    skipInitialReroll(g2);
    g2.phase = 'main';
    g2.activePlayer = 'B';
    g2.challenge!.turn = 2;
    g2.challenge!.resumeAt = 5;
    g2.challenge!.driven = [die('d1', 2), die('d2', 2), die('d5', 5), die('d6', 5)];
    g2.players.B.areas.defense = [];
    g2.pending = null; // 同上：清 D1 代决
    applyAction(g2, { t: 'challengeStep' });
    expect(vals(g2.players.B.areas.defense)).toEqual([2, 2]);
  });
});

describe('挑战模式 · Z04 D1（开局选骰）', () => {
  it('情形 1：梦醒可吃的同点 ≥2 种 → 选项＝各点值（kind dream）；顿悟必断', () => {
    const g = make();
    g.challenge!.driven = [
      die('a1', 2), die('a2', 2), die('a3', 2), die('a4', 2),
      die('b1', 5), die('b2', 5), die('b3', 5), die('b4', 5), die('c1', 1), die('c2', 3),
    ];
    const plans = legendAssignNeeded(g);
    expect(plans).not.toBeNull();
    expect(plans!.map((p) => p.kind)).toEqual(['dream', 'dream']);
    expect(plans!.map((p) => p.dreamV)).toEqual([2, 5]);
    expect(plans!.every((p) => p.straightS === null)).toBe(true); // 顿悟必断
  });

  it('情形 2：梦醒仅 1 种、顿悟 ≥2 个顺点窗口 → 选项＝各窗口（kind straight）', () => {
    const g = make();
    g.challenge!.driven = [
      die('a1', 2), die('a2', 2), die('a3', 2), die('a4', 2), die('a5', 2),
      die('b', 1), die('c', 3), die('d', 4), die('e', 5), die('f', 6),
    ];
    const plans = legendAssignNeeded(g);
    expect(plans).not.toBeNull();
    expect(plans!.every((p) => p.kind === 'straight')).toBe(true);
    expect(plans!.map((p) => p.straightS)).toEqual([1, 2, 3]); // 1234 / 2345 / 3456
    expect(plans!.every((p) => p.dreamV === 2)).toBe(true); // 梦醒固定吃 2
  });

  it('没得选：既无 ≥2 种同点、也无 ≥2 个顺点窗口 → null', () => {
    const g = make();
    g.challenge!.driven = [die('a', 1), die('b', 2), die('c', 3), die('d', 5), die('e', 6)];
    expect(legendAssignNeeded(g)).toBeNull();
  });

  it('自动：有利＝取大、不利＝取小', () => {
    const g = make();
    g.challenge!.driven = [
      die('a1', 2), die('a2', 2), die('a3', 2), die('a4', 2),
      die('b1', 5), die('b2', 5), die('b3', 5), die('b4', 5), die('c1', 1), die('c2', 3),
    ];
    const plans = legendAssignNeeded(g)!;
    expect(legendAssignAuto(plans, 'favor').dreamV).toBe(5); // 有利＝先花大点
    expect(legendAssignAuto(plans, 'against').dreamV).toBe(2); // 不利＝先花小点
  });

  it('结算：梦醒时分按 assign 消耗指定的那 4 颗', () => {
    const g = make();
    skipInitialReroll(g);
    g.pending = null; // 清掉开局可能弹出的 D1（本用例直接铺 assign）
    g.challenge!.turn = 1; // 非首回合（否则「怜悯*」会跳过 z04-2）
    g.challenge!.resumeAt = 2; // z04-2 梦醒时分
    g.challenge!.driven = [
      die('d1', 2), die('d2', 2), die('d3', 2), die('d4', 2),
      die('d5', 5), die('d6', 5), die('d7', 5), die('d8', 5),
    ];
    g.challenge!.assign = { 'z04-2': ['d5', 'd6', 'd7', 'd8'] };
    applyAction(g, { t: 'challengeStep' });
    expect(vals(g.challenge!.driven)).toEqual([2, 2, 2, 2]); // 消耗的是 5 那组
  });
});
