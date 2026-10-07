import { describe, it, expect } from 'vitest';
import { setupGame } from '../src/core/engine/setup';
import { getLegalActions, applyAction, beginTurn, createGame, endTurn } from '../src/core/engine/game';
import { consumeDice, SKILL_HANDLERS } from '../src/core/engine/skills';
import { canTargetForDustRise } from '../src/core/engine/dustRise';
import { hasActiveSkill } from '../src/core/engine/skill-state';
import {
  afterAttackResolved,
  applyLifeLoss,
  dealTrueDamage,
  finalizeAttackResolution,
  pumpAttackQueue,
  virtualAttack,
} from '../src/core/engine/combat';
import { pumpPending } from '../src/core/engine/pending';
import { fxReset, fxTake } from '../src/core/engine/fx';
import { endPhase } from '../src/core/engine/phases';
import { paySlots, heal } from '../src/core/engine/effects';
import { effectiveWill, totalDice } from '../src/core/engine/derive';
import { incrementDustfall } from '../src/core/engine/dustfall';
import { SeededRng } from '../src/core/rng/rng';
import type { GameState } from '../src/core/model/types';
import type { Action, DiceKind, Die, PendingAttack, PlayerId } from '../src/core/model/types';

const die = (id: string, value: number, kind: DiceKind): Die => ({ id, value, kind });

describe('L01 雨落狂流（持续+触发）', () => {
  it('弃置"不符合骰点分布"的骰 → 计数 +1；达 3 → 归零并排队待决策', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L01' });
    g.phase = 'main';
    // 空（001/002/003）第二列分布 = 游龙 002：attack [3,4]
    const p = g.players.A;
    p.areas.attack.push(die('a1', 1, 'attack'), die('a2', 1, 'attack'), die('a3', 1, 'attack'));
    consumeDice(g, p, 'attack', ['a1']);
    expect(p.legend!.count).toBe(1);
    consumeDice(g, p, 'attack', ['a2']);
    expect(p.legend!.count).toBe(2);
    consumeDice(g, p, 'attack', ['a3']);
    expect(p.legend!.count).toBe(0);
    expect(g.pendingQueue.filter((x) => x.kind === 'kongYuluo')).toHaveLength(1);
  });

  it('符合分布的骰 → 不计数', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L01' });
    g.phase = 'main';
    const p = g.players.A;
    p.areas.attack.push(die('a1', 3, 'attack')); // 3 ∈ {3,4} → 符合
    consumeDice(g, p, 'attack', ['a1']);
    expect(p.legend!.count).toBe(0);
  });

  it('口径 (B)：你的骰被"别人/别的技能"弃置 → 同样计数（不看是谁执行的）', () => {
    const g = setupGame({
      seed: 1,
      firstPlayer: 'A',
      legendA: 'L01',
      legendB: 'L01',
      heroB: ['001', '002', '003'],
    });
    g.phase = 'main';
    // B 的骰（1 ∉ 空系 attack[3,4] → 不符合 B 的分布）被弃置（等价于"对方技能弃你的骰"）
    g.players.B.areas.attack.push(die('b1', 1, 'attack'));
    consumeDice(g, g.players.B, 'attack', ['b1']);
    expect(g.players.B.legend!.count).toBe(1);
  });

  it('口径 (B)：003「斩神切」弃置自己的全部能力骰 → 也计数', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L01', heroA: ['001', '002', '003'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    const p = g.players.A;
    p.artifacts.find((x) => x.id === '003')!.activeMarkerSide = 'left';
    p.areas.attack.push(die('a1', 1, 'attack')); // 不符合分布
    const act = getLegalActions(g).find((a) => a.t === 'skill' && a.artifactId === '003')!;
    applyAction(g, act);
    expect(p.legend!.count).toBe(1);
    expect(p.areas.attack).toHaveLength(0);
  });

  it('口径 (B)：009「高塔铁幕」弃置自己的全部能力骰 → 也计数', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L01', heroA: ['007', '008', '009'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    const p = g.players.A;
    p.artifacts.find((x) => x.id === '009')!.activeMarkerSide = 'left';
    p.areas.attack.push(die('a1', 1, 'attack')); // 007/008/009 的分布：008 第二列 attack [2,5] → 1 不符合
    const act = getLegalActions(g).find((a) => a.t === 'skill' && a.artifactId === '009')!;
    applyAction(g, act);
    expect(p.legend!.count).toBe(1);
  });

  it('口径 (B)：结束阶段弃骰（超出意志上限）→ 也计数', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L01' });
    const p = g.players.A;
    expect(totalDice(p)).toBe(effectiveWill(p)); // 空：意志 7
    p.areas.attack.push(die('x1', 1, 'attack')); // 1 ∉ {3,4} → 超出上限 1
    endPhase(g, 'A', ['x1']);
    expect(p.legend!.count).toBe(1);
    expect(totalDice(p)).toBe(effectiveWill(p));
  });

  it('粒度：一次效果弃置**多类型**骰 → 只 +1（不按类型/骰数重复计）——003 斩神切', () => {
    const g = setupGame({
      seed: 1,
      firstPlayer: 'A',
      legendA: 'L01',
      legendB: 'L01',
      heroA: ['001', '002', '003'],
      heroB: ['004', '005', '006'],
    });
    g.phase = 'main';
    g.activePlayer = 'A';
    const p = g.players.A;
    p.artifacts.find((x) => x.id === '003')!.activeMarkerSide = 'left';
    // 002 分布：攻[3,4] 防[1,6] 冥[2,5] → 三类型各 1 颗**全不符合**（修复前会被按类型计成 +3）
    p.areas.attack = [die('a1', 1, 'attack')];
    p.areas.defense = [die('d1', 2, 'defense')];
    p.areas.meditation = [die('m1', 1, 'meditation')];
    // 对方 B（005 分布：攻[1,2,6] 防[3] 冥[4,5]）→ 防/冥各 1 颗不符合（修复前对方 L01 会被计成 +2）
    g.players.B.areas.attack = [];
    g.players.B.areas.defense = [die('bd1', 1, 'defense')];
    g.players.B.areas.meditation = [die('bm1', 1, 'meditation')];
    const act = getLegalActions(g).find((a) => a.t === 'skill' && a.artifactId === '003')!;
    applyAction(g, act);
    expect(p.legend!.count).toBe(1); // 一次效果 = +1
    expect(g.players.B.legend!.count).toBe(1); // 弃对方（一次效果）= 对方 L01 +1
  });

  it('粒度：009「高塔铁幕」弃置多类型全部骰 → 只 +1', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L01', heroA: ['007', '008', '009'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    const p = g.players.A;
    p.artifacts.find((x) => x.id === '009')!.activeMarkerSide = 'left';
    // 008 分布：攻[2,5] 防[1,6] 冥[3,4] → 三类型各 1 颗全不符合
    p.areas.attack = [die('a1', 1, 'attack')];
    p.areas.defense = [die('d1', 2, 'defense')];
    p.areas.meditation = [die('m1', 1, 'meditation')];
    const act = getLegalActions(g).find((a) => a.t === 'skill' && a.artifactId === '009')!;
    applyAction(g, act);
    expect(p.legend!.count).toBe(1);
  });

  it('粒度：同一行动【消耗】与【弃置对方】= 2 次（分属两方各 +1）——007 战争横扫', () => {
    const g = setupGame({
      seed: 1,
      firstPlayer: 'A',
      legendA: 'L01',
      legendB: 'L01',
      heroA: ['007', '008', '009'],
      heroB: ['004', '005', '006'],
    });
    g.phase = 'main';
    g.activePlayer = 'A';
    const p = g.players.A;
    p.artifacts.find((x) => x.id === '007')!.activeMarkerSide = 'left';
    // 008 分布：攻[2,5] 防[1,6] 冥[3,4] → 1/2/1 全不符合（消耗 = 我方 1 次）
    p.areas.attack = [die('a1', 1, 'attack')];
    p.areas.defense = [die('d1', 2, 'defense')];
    p.areas.meditation = [die('m1', 1, 'meditation')];
    // 005 分布：攻[1,2,6] 防[3] 冥[4,5] → 1/1/1 全不符合（对方被弃 = 对方 1 次）
    g.players.B.areas.attack = [die('ba1', 1, 'attack')];
    g.players.B.areas.defense = [die('bd1', 1, 'defense')];
    g.players.B.areas.meditation = [die('bm1', 1, 'meditation')];
    applyAction(g, {
      t: 'skill',
      artifactId: '007',
      side: 'left',
      params: {
        costSlots: [{ dieIds: ['a1'] }, { dieIds: ['d1'] }, { dieIds: ['m1'] }],
        discard: { attack: 'ba1', defense: 'bd1', meditation: 'bm1' },
      },
    });
    expect(p.legend!.count).toBe(1); // 消耗（我方）→ 我方 L01 +1
    expect(g.players.B.legend!.count).toBe(1); // 弃置对方（多类型）→ 对方 L01 只 +1
  });

  it('待决策合法动作：不发动 1 条 / ②按落区 3 条 / ①按对方每颗骰；②确认后获得随机骰', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L01' });
    g.phase = 'main';
    g.players.B.areas.defense.push(die('b1', 6, 'defense'));
    g.pending = { kind: 'kongYuluo', player: 'A' };
    const acts = getLegalActions(g);
    expect(acts.filter((a) => a.t === 'kongYuluo' && a.choice === 'decline')).toHaveLength(1);
    expect(
      acts.filter((a) => a.t === 'kongYuluo' && a.choice === 'gain').map((a) => (a as { kind?: string }).kind),
    ).toEqual(['attack', 'defense', 'meditation']);
    expect(acts.some((a) => a.t === 'kongYuluo' && a.choice === 'discard' && a.dieId === 'b1')).toBe(true);

    const before = g.players.A.areas.attack.length;
    applyAction(g, { t: 'kongYuluo', choice: 'gain', kind: 'attack' });
    expect(g.pending).toBeNull();
    expect(g.players.A.areas.attack.length).toBe(before + 1);
  });

  it('待决策 ①：弃置对方指定 1 颗骰（口径 (B) 下骰主因此计数）', () => {
    const g = setupGame({
      seed: 1,
      firstPlayer: 'A',
      legendA: 'L01',
      legendB: 'L01',
      heroB: ['001', '002', '003'],
    });
    g.phase = 'main';
    g.players.B.areas.defense.push(die('b1', 3, 'defense')); // 3 ∉ 空系 defense[1,6] → 不符合分布
    g.pending = { kind: 'kongYuluo', player: 'A' };
    applyAction(g, { t: 'kongYuluo', choice: 'discard', dieId: 'b1' });
    expect(g.players.B.areas.defense.some((d) => d.id === 'b1')).toBe(false);
    expect(g.players.B.legend!.count).toBe(1); // (B)：骰主（B）也计数
  });

  it('待决策 不发动：不改状态、清空待决策', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L01' });
    g.phase = 'main';
    g.pending = { kind: 'kongYuluo', player: 'A' };
    applyAction(g, { t: 'kongYuluo', choice: 'decline' });
    expect(g.pending).toBeNull();
  });
});

describe('L01 断苇一斩（触发）', () => {
  it('回合开始判定"上回合是否整回合无伤害"（首回合不可发动）；造成伤害会记录', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L01' });
    g.phase = 'main';
    g.activePlayer = 'A';
    // 首回合：即使没造成伤害也不算（没有"上一个回合"）
    g.firstRound.A = true;
    g.players.A.dealtDamageThisTurn = false;
    beginTurn(g);
    expect(g.players.A.noDamageLastTurn).toBe(false);
    // 第二回合起：上回合（整回合）无伤害 → true
    g.firstRound.A = false;
    g.players.A.dealtDamageThisTurn = false;
    beginTurn(g);
    expect(g.players.A.noDamageLastTurn).toBe(true);
    // 上回合造成过伤害 → false
    g.players.A.dealtDamageThisTurn = true;
    beginTurn(g);
    expect(g.players.A.noDamageLastTurn).toBe(false);
    // 造成伤害会置位（真伤，来源＝当前回合玩家）
    g.activePlayer = 'A';
    dealTrueDamage(g, 'B', 1, 'A');
    expect(g.players.A.dealtDamageThisTurn).toBe(true);
  });

  it('满足条件时启动斩神切多一条"弃置对方全部能力骰"合法动作；执行后对方全部能力骰被弃', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L01' });
    g.phase = 'main';
    g.activePlayer = 'A';
    const ming = g.players.A.artifacts.find((x) => x.id === '003')!;
    ming.activeMarkerSide = 'left'; // 明镜已激活 → 必杀可用
    g.players.A.noDamageLastTurn = true;
    g.players.A.areas.attack.push(die('a1', 3, 'attack'));
    g.players.B.areas.attack.push(die('b1', 3, 'attack'));
    g.players.B.areas.defense.push(die('b2', 1, 'defense'));
    g.players.B.areas.meditation.push(die('b3', 2, 'meditation'));

    const acts = getLegalActions(g);
    const extra = acts.find(
      (x) => x.t === 'skill' && x.artifactId === '003' && (x as { params?: { opponentDiscardAll?: boolean } }).params?.opponentDiscardAll === true,
    );
    expect(extra).toBeDefined();
    applyAction(g, extra as Action);
    expect(g.players.B.areas.attack).toHaveLength(0);
    expect(g.players.B.areas.defense).toHaveLength(0);
    expect(g.players.B.areas.meditation).toHaveLength(0);
  });

  it('残影：影袭每回合可启动 2 次（无面板则 1 次）', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendB: 'L02', heroB: ['004', '005', '006'] });
    g.phase = 'main';
    g.activePlayer = 'B';
    const p = g.players.B;
    p.artifacts.find((x) => x.id === '005')!.activeMarkerSide = 'left';
    p.areas.attack.push(die('x1', 3, 'attack'));
    const has = (): boolean =>
      getLegalActions(g).some((a) => a.t === 'skill' && a.artifactId === '005');
    expect(has()).toBe(true);
    g.skillsUsedThisTurn.push('B:yingle.yingxi');
    expect(has()).toBe(true); // 残影 → 还能用第 2 次
    g.skillsUsedThisTurn.push('B:yingle.yingxi');
    expect(has()).toBe(false); // 到 2 次上限

    // 对照：A 无面板 → 用 1 次后不可再用
    const g2 = setupGame({ seed: 1, firstPlayer: 'A', heroA: ['004', '005', '006'] });
    g2.phase = 'main';
    g2.activePlayer = 'A';
    g2.players.A.artifacts.find((x) => x.id === '005')!.activeMarkerSide = 'left';
    g2.players.A.areas.attack.push(die('y1', 3, 'attack'));
    const has2 = (): boolean =>
      getLegalActions(g2).some((a) => a.t === 'skill' && a.artifactId === '005');
    expect(has2()).toBe(true);
    g2.skillsUsedThisTurn.push('A:yingle.yingxi');
    expect(has2()).toBe(false);
  });

  it('残影：尘起行动每阶段可进行 2 次（无面板则 1 次）', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L02', heroA: ['004', '005', '006'] });
    g.phase = 'dustRise';
    g.activePlayer = 'A';
    g.players.A.areas.meditation.push(die('m1', 2, 'meditation'));
    g.dustRiseNormalCount = 1;
    const hasNormal = (): boolean =>
      getLegalActions(g).some((a) => a.t === 'dustRise' && !a.free && !a.useSeal);
    expect(hasNormal()).toBe(true); // 残影 → 第 2 次仍可
    g.dustRiseNormalCount = 2;
    expect(hasNormal()).toBe(false);

    const g2 = setupGame({ seed: 1, firstPlayer: 'A', heroA: ['004', '005', '006'] });
    g2.phase = 'dustRise';
    g2.activePlayer = 'A';
    g2.players.A.areas.meditation.push(die('m1', 2, 'meditation'));
    g2.dustRiseNormalCount = 1;
    expect(
      getLegalActions(g2).some((a) => a.t === 'dustRise' && !a.free && !a.useSeal),
    ).toBe(false); // 无面板 → 已用过 1 次，不能再尘起
  });

  it('暗夜凶神：锋芒取消对方防御骰后 → 可选使「不祥」计数 +1', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L02', heroA: ['004', '005', '006'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    const p = g.players.A;
    p.artifacts.find((x) => x.id === '004')!.activeMarkerSide = 'right';
    p.areas.attack.push(die('a1', 3, 'attack'));
    p.areas.meditation.push(die('m1', 2, 'meditation'));
    g.pending = { kind: 'fengmang', player: 'A', defenderId: 'B', value: 4 };
    applyAction(g, { t: 'fengmang', accept: true, attackDieId: 'a1', meditationDieId: 'm1' });
    expect(g.pending?.kind).toBe('anyexiongshen');
    const card = p.artifacts.find((x) => x.id === '004')!;
    const before = card.count;
    applyAction(g, { t: 'anyexiongshen', accept: true });
    expect(card.count).toBe(before + 1);
  });

  it('不满足（上回合造成过伤害）→ 不出现"弃置对方全部"的额外动作', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L01' });
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.A.artifacts.find((x) => x.id === '003')!.activeMarkerSide = 'left';
    g.players.A.noDamageLastTurn = false;
    const acts = getLegalActions(g);
    expect(
      acts.some(
        (x) => x.t === 'skill' && (x as { params?: { opponentDiscardAll?: boolean } }).params?.opponentDiscardAll === true,
      ),
    ).toBe(false);
  });
});

describe('L02 潸然的葬敌花（必杀·尘落前置 1）', () => {
  it('尘落 <1 → 不出现；≥1 → 可发动（双方各获 3 颗）；整局一次', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L02', heroA: ['004', '005', '006'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    const hasUlt = (): boolean =>
      getLegalActions(g).some((a) => a.t === 'skill' && a.artifactId === 'L02');
    g.dustfall = 0;
    expect(hasUlt()).toBe(false); // 尘落前置 1 未满足
    g.dustfall = 1;
    expect(hasUlt()).toBe(true);
    const beforeA = totalDice(g.players.A);
    const beforeB = totalDice(g.players.B);
    applyAction(g, { t: 'skill', artifactId: 'L02', side: 'only' } as Action);
    expect(g.ultimatesUsed).toContain('A:ying.zangdihua');
    expect(totalDice(g.players.A)).toBe(beforeA + 3);
    expect(totalDice(g.players.B)).toBe(beforeB + 3);
    expect(hasUlt()).toBe(false); // 必杀整局一次
  });
});

describe('L03 拔城 + 统御战场', () => {
  it('拔城：启动「主宰」技能后，对方弃置数 < 我消耗数 → 可选发动（视为 5 点攻击 + 切换主宰）', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L03', heroA: ['007', '008', '009'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    const p = g.players.A;
    const zz = p.artifacts.find((x) => x.id === '007')!;
    zz.activeMarkerSide = 'left';
    p.areas.attack.push(die('a1', 3, 'attack'));
    p.areas.defense.push(die('d1', 1, 'defense'));
    p.areas.meditation.push(die('m1', 2, 'meditation'));
    // 对方**只剩** 1 颗防御骰（攻/冥清空）→「弃置数 1 < 消耗数 3」→ 拔城可发动（**合法缺类**路径）
    for (const k of ['attack', 'defense', 'meditation'] as const) g.players.B.areas[k] = [];
    g.players.B.areas.defense.push(die('b1', 6, 'defense'));
    const act: Action = {
      t: 'skill',
      artifactId: '007',
      side: 'left',
      params: {
        costSlots: [{ dieIds: ['a1'] }, { dieIds: ['d1'] }, { dieIds: ['m1'] }],
        discard: { defense: 'b1' },
      },
    };
    applyAction(g, act);
    expect(g.pending?.kind).toBe('bacheng');
    applyAction(g, { t: 'bacheng', accept: true });
    expect(zz.activeMarkerSide).toBe('right'); // 已切换「主宰」技能
  });

  it('统御战场：受攻击伤害 → 「孤王」充能 +1 且连锁执行「高塔铁幕」（封顶 3、满亦不再）', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendB: 'L03', heroB: ['007', '008', '009'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    const guwang = g.players.B.artifacts.find((x) => x.id === '009')!;
    expect(guwang.chargeLayer).toBe(0);
    // A 有 1 颗 6 点攻击骰 → 「高塔铁幕」把它改为 1
    g.players.A.areas.attack.push(die('atk', 6, 'attack'));
    const pa = { attacker: 'A', value: 3 } as PendingAttack;

    // 第 1 次伤害 → 充能 1，并连锁弹出「高塔铁幕」待决策
    afterAttackResolved(g, pa, { blocked: false, damageDealt: 3 });
    expect(guwang.chargeLayer).toBe(1);
    expect(g.pending?.kind).toBe('guwangCharge');
    applyAction(g, { t: 'guwangCharge', dieId: 'atk' });
    expect(g.players.A.areas.attack.find((d) => d.id === 'atk')!.value).toBe(1); // 已改为 1 点
    expect(g.pending).toBeNull();

    // 第 2、3 次伤害 → 逐次 +1（连锁时点：攻击与攻击之间）
    afterAttackResolved(g, pa, { blocked: false, damageDealt: 3 });
    expect(guwang.chargeLayer).toBe(2);
    if (g.pending?.kind === 'guwangCharge') applyAction(g, { t: 'guwangCharge' }); // 不变更
    afterAttackResolved(g, pa, { blocked: false, damageDealt: 3 });
    expect(guwang.chargeLayer).toBe(3);

    // 满 3 后再受伤害 → 不再 +1、不再连锁
    if (g.pending?.kind === 'guwangCharge') applyAction(g, { t: 'guwangCharge' });
    afterAttackResolved(g, pa, { blocked: false, damageDealt: 3 });
    expect(guwang.chargeLayer).toBe(3);
  });

  it('统御战场：被抵挡（0 伤害）不触发；对方无攻击骰可改时只充能不弹选择', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendB: 'L03', heroB: ['007', '008', '009'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    const guwang = g.players.B.artifacts.find((x) => x.id === '009')!;
    const pa = { attacker: 'A', value: 3 } as PendingAttack;
    afterAttackResolved(g, pa, { blocked: true, damageDealt: 0 });
    expect(guwang.chargeLayer).toBe(0); // 被抵挡 → 不计
    // 清空 A 的攻击骰 → 高塔铁幕无目标，只充能、不弹选择
    g.players.A.areas.attack = [];
    afterAttackResolved(g, pa, { blocked: false, damageDealt: 3 });
    expect(guwang.chargeLayer).toBe(1);
    expect(g.pending).toBeNull();
  });
});

describe('L04 无上剑术（持续）', () => {
  it('使用 5 点攻击骰 → 回复 1 生命/颗；使用 5 点防御骰 → 对对方造成 1 真伤/颗', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L04', heroA: ['010', '011', '012'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    const A = g.players.A;
    A.life = 30; // 012 魔女 lifeMax=40 → 有回血空间
    A.areas.attack.push(die('a5', 5, 'attack'));
    paySlots(g, 'A', [{ kind: 'attack' }], [{ dieIds: ['a5'] }], undefined, 'attack');
    expect(A.life).toBe(31);
    A.areas.defense.push(die('d5', 5, 'defense'));
    const beforeB = g.players.B.life;
    paySlots(g, 'A', [{ kind: 'defense' }], [{ dieIds: ['d5'] }], undefined, 'defense');
    expect(g.players.B.life).toBe(beforeB - 1);
  });

  it('010 置换出的骰（有效值 5）同样触发；非 5 点不触发；「消耗」不触发', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L04', heroA: ['010', '011', '012'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    const A = g.players.A;
    A.life = 30; // 012 魔女 lifeMax=40 → 有回血空间
    // 置换：2 颗任意骰 → 视为 1 颗攻击骰（有效值 5）
    A.areas.attack.push(die('x1', 3, 'attack'), die('x2', 4, 'attack'));
    paySlots(g, 'A', [{ kind: 'attack' }], [{ dieIds: ['x1', 'x2'] }], undefined, 'attack');
    expect(A.life).toBe(31);
    // 非 5 点 → 不回复
    A.areas.attack.push(die('a4', 4, 'attack'));
    paySlots(g, 'A', [{ kind: 'attack' }], [{ dieIds: ['a4'] }], undefined, 'attack');
    expect(A.life).toBe(31);
    // 「消耗」（reason='skill'）→ 不触发
    A.areas.attack.push(die('a5b', 5, 'attack'));
    paySlots(g, 'A', [{ kind: 'attack' }], [{ dieIds: ['a5b'] }], undefined, 'skill');
    expect(A.life).toBe(31);
  });

  it('触发时发 skillFired（无上剑术）；非 5 点不发', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L04', heroA: ['010', '011', '012'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    const A = g.players.A;
    A.life = 30;
    A.areas.attack.push(die('a5', 5, 'attack'));
    fxReset();
    paySlots(g, 'A', [{ kind: 'attack' }], [{ dieIds: ['a5'] }], undefined, 'attack');
    expect(fxTake().some((e) => e.kind === 'skillFired' && e.skillKey === 'tata.wushangjianshu')).toBe(true);
    A.areas.attack.push(die('a4', 4, 'attack'));
    fxReset();
    paySlots(g, 'A', [{ kind: 'attack' }], [{ dieIds: ['a4'] }], undefined, 'attack');
    expect(fxTake().some((e) => e.kind === 'skillFired' && e.skillKey === 'tata.wushangjianshu')).toBe(false);
  });
});

describe('L04 我将在下个梦境与你再度相逢（必杀）', () => {
  /** 归一化快照：排除骰子点位/随机/日志/先手/生命/尘落/计数/技能列表（这些单独断言） */
  const norm = (g: GameState) => ({
    phase: g.phase,
    activePlayer: g.activePlayer,
    initialRerollQueue: g.initialRerollQueue,
    turnIndex: g.turnIndex,
    firstRound: g.firstRound,
    pending: g.pending,
    pendingQueue: g.pendingQueue,
    pendingAttack: g.pendingAttack,
    attackQueue: g.attackQueue,
    virtualQueue: g.virtualQueue,
    extraReroll: g.extraReroll,
    unblockableThisTurn: g.unblockableThisTurn,
    caiyuliuUsed: g.caiyuliuUsed,
    dustRiseNormalCount: g.dustRiseNormalCount,
    dustRiseActed: g.dustRiseActed,
    freeDustRise: g.freeDustRise,
    freeNoCostRise: g.freeNoCostRise,
    rerollUsed: g.rerollUsed,
    skillsUsedThisTurn: g.skillsUsedThisTurn,
    ultimatesUsed: g.ultimatesUsed,
    skillConsumedThisAction: g.skillConsumedThisAction,
    dunwuPulseUsedThisTurn: g.dunwuPulseUsedThisTurn,
    chenaiUsed: g.chenaiUsed,
    attacksThisTurn: g.attacksThisTurn,
    hunhunGained: g.hunhunGained,
    rerollPunish: g.rerollPunish,
    tianfa: g.tianfa,
    winner: g.winner,
    players: (['A', 'B'] as const).map((id) => {
      const p = g.players[id];
      return {
        id: p.id,
        markers: p.markers,
        // hasDustSeal 单独断言（重开一局不发尘印、与"全新一局"不同）
        buffs: p.buffs,
        damagedThisTurn: p.damagedThisTurn,
        attackHalvedNextTurn: p.attackHalvedNextTurn,
        dealtDamageThisTurn: p.dealtDamageThisTurn,
        noDamageLastTurn: p.noDamageLastTurn,
        // 骰子点位随机 → 只比**总数**（各区计数取决于点数，不稳定）
        diceTotal: p.areas.attack.length + p.areas.defense.length + p.areas.meditation.length,
        artifacts: p.artifacts.map((a) => ({
          id: a.id,
          activeMarkerSide: a.activeMarkerSide,
          armedSide: a.armedSide,
          armedTurn: a.armedTurn,
          chargeLayer: a.chargeLayer,
          heldDiceCount: (a.heldDice ?? []).length,
          continuousLost: !!a.continuousLost,
          continuousLostThisTurn: !!a.continuousLostThisTurn,
        })),
      };
    }),
  });

  it('继承生命/尘落/计数；重置其余状态；重开一局；失去本技能；战报保留', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L04', heroA: ['010', '011', '012'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.A.life = 33;
    g.players.B.life = 21;
    g.dustfall = 2;
    g.players.A.artifacts[0].count = 2;
    g.players.A.legend!.count = 1;
    g.players.A.artifacts[0].activeMarkerSide = 'left';
    g.players.A.artifacts[2].chargeLayer = 2;
    g.players.A.artifacts[1].heldDice = [{ id: 'h', value: 3 }];
    g.players.A.buffs.push({ attr: 'speed', add: 1, duration: 'thisTurn' });
    g.ultimatesUsed.push('A:monv.ultimate');
    g.pendingQueue.push({ kind: 'kongYuluo', player: 'A' });
    g.turnIndex = 5;
    g.firstRound = { A: false, B: false };
    const logLen = g.log.length;

    applyAction(g, { t: 'skill', artifactId: 'L04', side: 'only', params: { first: 'B' } });

    // 继承
    expect(g.players.A.life).toBe(33);
    expect(g.players.B.life).toBe(21);
    expect(g.dustfall).toBe(2);
    expect(g.players.A.artifacts[0].count).toBe(2);
    expect(g.players.A.legend!.count).toBe(1);
    // 重置
    expect(g.players.A.artifacts[0].activeMarkerSide).toBeNull();
    expect(g.players.A.artifacts[2].chargeLayer).toBe(0);
    expect(g.players.A.artifacts[1].heldDice).toEqual([]);
    expect(g.players.A.buffs).toEqual([]);
    expect(g.ultimatesUsed).toEqual([]);
    expect(g.pendingQueue).toEqual([]);
    expect(g.turnIndex).toBe(0);
    expect(g.firstRound).toEqual({ A: true, B: true });
    // 开局流程
    expect(g.firstPlayer).toBe('B');
    expect(g.activePlayer).toBe('B');
    expect(g.phase).toBe('initialReroll');
    expect(g.initialRerollQueue).toEqual(['B', 'A']);
    // 重开一局**不发尘印标记**（本次改定）
    expect(g.players.A.hasDustSeal).toBe(false);
    expect(g.players.B.hasDustSeal).toBe(false);
    // 重投骰（按意志）
    expect(totalDice(g.players.A)).toBe(effectiveWill(g.players.A));
    expect(totalDice(g.players.B)).toBe(effectiveWill(g.players.B));
    // 失去本技能
    expect(g.players.A.legend!.skills.some((s) => s.key === 'tata.mengjing')).toBe(false);
    // 战报保留（不短于之前，且新增了记录）
    expect(g.log.length).toBeGreaterThan(logLen);
  });

  it('发动时发 `reset` 动效事件（供界面走"全部合成一个再分回"的专用动画）', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L04', heroA: ['010', '011', '012'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    fxReset();
    applyAction(g, { t: 'skill', artifactId: 'L04', side: 'only', params: { first: 'A' } });
    expect(fxTake().some((e) => e.kind === 'reset')).toBe(true);
  });

  it('对照：重启后局面（排除 骰子/随机/日志/生命/尘落/计数/技能列表）与"同英雄同面板的全新一局"逐字段一致', () => {
    const g = setupGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['010', '011', '012'],
      legendA: 'L04',
      heroB: ['007', '008', '009'],
      legendB: 'L03',
    });
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.A.artifacts[0].activeMarkerSide = 'left';
    g.players.A.artifacts[2].chargeLayer = 1;
    g.turnIndex = 5;
    g.firstRound = { A: false, B: false };
    g.pendingQueue.push({ kind: 'kongYuluo', player: 'A' });
    applyAction(g, { t: 'skill', artifactId: 'L04', side: 'only', params: { first: 'B' } });

    const fresh = createGame({
      seed: 999,
      firstPlayer: 'B',
      heroA: ['010', '011', '012'],
      legendA: 'L04',
      heroB: ['007', '008', '009'],
      legendB: 'L03',
    });
    // 重开一局**不发尘印**（与"全新一局"刻意不同，故不参与 norm 比对）
    expect(g.players.A.hasDustSeal).toBe(false);
    expect(g.players.B.hasDustSeal).toBe(false);
    expect(norm(g)).toEqual(norm(fresh));
  });
});

describe('L05 复仇之灵（持续）', () => {
  it('生命十位数变化 → 强制额外尘起待决策；跨多位只 1 次；十位数不变不触发', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L05', heroA: ['013', '014', '015'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    const A = g.players.A;
    expect(A.lifeTens).toBe(5); // 015 残响 life 50
    const q = () => g.pendingQueue.filter((x) => x.kind === 'fuchouRise').length;
    applyLifeLoss(g, 'A', 15); // 50 → 35：十位数 5→3（跨多位）→ 只 1 次
    expect(A.lifeTens).toBe(3);
    expect(q()).toBe(1);
    applyLifeLoss(g, 'A', 1); // 35 → 34：十位数不变 → 不触发
    expect(q()).toBe(1);
    applyLifeLoss(g, 'A', 5); // 34 → 29：3→2 → 再 1 次
    expect(q()).toBe(2);
  });

  it('非当前回合玩家触发：强制尘起作用于「该玩家」的神器（不抛错、不取错玩家）', () => {
    const g = setupGame({
      seed: 1,
      firstPlayer: 'A',
      legendB: 'L05',
      heroB: ['013', '014', '015'],
    });
    g.phase = 'main';
    g.activePlayer = 'A'; // 当前回合玩家 = A；触发者 = B
    g.players.B.life = 40;
    g.players.B.lifeTens = 4;
    applyLifeLoss(g, 'B', 5); // 40 → 35：十位数 4→3 → B 的强制尘起
    pumpPending(g);
    expect(g.pending?.kind).toBe('fuchouRise');
    const acts = getLegalActions(g);
    expect(acts.length).toBeGreaterThan(0);
    const pick = acts.find((a) => a.t === 'dustRise' && a.artifactId === '013')!;
    const art013 = g.players.B.artifacts.find((x) => x.id === '013')!;
    const before = art013.activeMarkerSide;
    applyAction(g, pick);
    expect(art013.activeMarkerSide).not.toBe(before); // B 的 013 被尘起
    expect(g.pending).toBeNull();
  });

  it('强制额外尘起动作：不耗冥想骰、不占次数、不消耗 freeNoCostRise', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L05', heroA: ['013', '014', '015'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.A.artifacts[1].activeMarkerSide = null; // 014 惩戒未激活 → 可尘起
    g.pending = { kind: 'fuchouRise', player: 'A' };
    const acts = getLegalActions(g);
    expect(acts.length).toBeGreaterThan(0);
    expect(acts.every((a) => a.t === 'dustRise' && a.fuchou === true && a.free === true)).toBe(true);
    const beforeMed = g.players.A.areas.meditation.length;
    const beforeCount = g.dustRiseNormalCount;
    const beforeFree = g.freeNoCostRise;
    // 选 013 鸣雷（持续/触发类，不产生"激活"待决策）
    const pick = acts.find((a) => a.t === 'dustRise' && a.artifactId === '013')!;
    applyAction(g, pick);
    expect(g.pending).toBeNull();
    expect(g.players.A.areas.meditation.length).toBe(beforeMed); // 不耗冥想骰
    expect(g.dustRiseNormalCount).toBe(beforeCount); // 不占次数
    expect(g.freeNoCostRise).toBe(beforeFree); // 不消耗 freeNoCostRise
  });
});

describe('L05 无法饶恕（触发）', () => {
  it('造成伤害后可选弃置对方"点数＝该攻击点数"的防御骰', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L05', heroA: ['013', '014', '015'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.B.areas.defense.push(die('b3', 3, 'defense'));
    afterAttackResolved(g, { attacker: 'A', value: 3, baseValue: 3 } as PendingAttack, {
      blocked: false,
      damageDealt: 3,
    });
    pumpPending(g);
    expect(g.pending?.kind).toBe('wufaraoshu');
    applyAction(g, { t: 'wufaraoshu', choice: 'discard', dieId: 'b3' });
    expect(g.players.B.areas.defense.some((d) => d.id === 'b3')).toBe(false);
  });

  it('按"点数"匹配而非"伤害"：伤害 5、点数 2、对方无 2 点防御骰 → 不触发', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L05', heroA: ['013', '014', '015'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.B.areas.defense.push(die('b5', 5, 'defense')); // 有 5 点（伤害）但没有 2 点（点数）
    const pa = { attacker: 'A', value: 5, baseValue: 2 } as PendingAttack;
    afterAttackResolved(g, pa, { blocked: false, damageDealt: 5 });
    pumpPending(g);
    expect(g.pending?.kind).not.toBe('wufaraoshu');
    g.players.B.areas.defense.push(die('b2', 2, 'defense')); // 补上 2 点 → 触发
    afterAttackResolved(g, pa, { blocked: false, damageDealt: 5 });
    pumpPending(g);
    expect(g.pending?.kind).toBe('wufaraoshu');
  });

  it('被抵挡（0 伤害）不触发', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L05', heroA: ['013', '014', '015'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.B.areas.defense.push(die('b3', 3, 'defense'));
    afterAttackResolved(g, { attacker: 'A', value: 3, baseValue: 3 } as PendingAttack, {
      blocked: true,
      damageDealt: 0,
    });
    expect(g.pending?.kind).not.toBe('wufaraoshu');
  });

  it('电刑多段：每段造成伤害都触发「无法饶恕」，且解决后自动续到下一段', () => {
    const g = setupGame({
      seed: 1,
      firstPlayer: 'A',
      legendA: 'L05',
      heroA: ['013', '014', '015'],
      heroB: ['001', '002', '003'],
    });
    g.phase = 'main';
    g.activePlayer = 'A';
    // B 有 1 / 2 / 3 点防御骰（对应 013「电刑」三段 1/2/3）
    g.players.B.areas.defense.push(
      die('b1', 1, 'defense'),
      die('b2', 2, 'defense'),
      die('b3', 3, 'defense'),
    );
    g.attackQueue = { player: 'A', values: [1, 2, 3] };

    // 第 1 段（1 点）
    pumpAttackQueue(g);
    expect(g.pendingAttack?.baseValue).toBe(1);
    finalizeAttackResolution(g, g.pendingAttack!, false); // 未抵挡 → 造成伤害
    expect(g.pending?.kind).toBe('wufaraoshu');
    applyAction(g, { t: 'wufaraoshu', choice: 'discard', dieId: 'b1' });
    // 解决后应自动续到第 2 段
    expect(g.pendingAttack?.baseValue).toBe(2);

    // 第 2 段（2 点）
    finalizeAttackResolution(g, g.pendingAttack!, false);
    expect(g.pending?.kind).toBe('wufaraoshu');
    applyAction(g, { t: 'wufaraoshu', choice: 'discard', dieId: 'b2' });
    expect(g.pendingAttack?.baseValue).toBe(3);

    // 第 3 段（3 点）
    finalizeAttackResolution(g, g.pendingAttack!, false);
    expect(g.pending?.kind).toBe('wufaraoshu');
    applyAction(g, { t: 'wufaraoshu', choice: 'discard', dieId: 'b3' });
    // 三段打完、队列清空
    expect(g.pendingAttack).toBeNull();
    expect(g.attackQueue).toBeNull();
  });
});

describe('L05 绝地惊雷（必杀·尘落前置 3）', () => {
  it('尘落<3 不出现；≥3 可发动：受 = 生命差 的自伤 + 获得 1 个 6 点攻击骰；整局一次', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L05', heroA: ['013', '014', '015'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    const hasUlt = (): boolean =>
      getLegalActions(g).some((a) => a.t === 'skill' && a.artifactId === 'L05');
    g.dustfall = 2;
    expect(hasUlt()).toBe(false);
    g.dustfall = 3;
    expect(hasUlt()).toBe(true);
    g.players.A.life = 40;
    g.players.A.lifeTens = 4;
    g.players.B.life = 46; // 差 6
    const beforeAtk = g.players.A.areas.attack.length;
    applyAction(g, { t: 'skill', artifactId: 'L05', side: 'only' });
    expect(g.players.A.life).toBe(34);
    expect(g.players.A.areas.attack.length).toBe(beforeAtk + 1);
    expect(g.players.A.areas.attack[g.players.A.areas.attack.length - 1].value).toBe(6);
    expect(g.ultimatesUsed).toContain('A:zoray.juedi');
    expect(hasUlt()).toBe(false);
  });

  it('生命差为 0 时：受 0 伤害、仍获得 6 点攻击骰', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L05', heroA: ['013', '014', '015'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    g.dustfall = 3;
    g.players.A.life = 30;
    g.players.A.lifeTens = 3;
    g.players.B.life = 30;
    const before = g.players.A.areas.attack.length;
    applyAction(g, { t: 'skill', artifactId: 'L05', side: 'only' });
    expect(g.players.A.life).toBe(30);
    expect(g.players.A.areas.attack.length).toBe(before + 1);
  });
});

describe('L06 圆舞（持续）', () => {
  it('受到自己造成的伤害后 → 强制移动 1 颗能力骰到另一区域（不能移到原区域）', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L06', heroA: ['016', '017', '018'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    const A = g.players.A;
    A.life = 40;
    A.areas.attack.push(die('a1', 3, 'attack'));
    dealTrueDamage(g, 'A', 4, 'A'); // 自伤
    pumpPending(g);
    expect(g.pending?.kind).toBe('yuanwu');
    const acts = getLegalActions(g);
    const toOf = (a: Action): DiceKind | undefined => (a as { to?: DiceKind }).to;
    expect(acts.every((a) => a.t === 'yuanwu')).toBe(true); // 待决策期间只有圆舞动作
    const pick = acts.find((a) => a.t === 'yuanwu' && (a as { dieId?: string }).dieId === 'a1')!;
    const to = toOf(pick)!;
    expect(to).not.toBe('attack'); // a1 在攻击区 → 只能移到防/冥
    applyAction(g, pick);
    expect(g.pending).toBeNull();
    expect(A.areas.attack.some((d) => d.id === 'a1')).toBe(false);
    expect(A.areas[to].some((d) => d.id === 'a1')).toBe(true);
  });

  it('对方造成的伤害不触发', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L06', heroA: ['016', '017', '018'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.A.life = 40;
    g.players.A.areas.attack.push(die('a1', 3, 'attack'));
    dealTrueDamage(g, 'A', 4, 'B'); // 来自对方
    pumpPending(g);
    expect(g.pending?.kind).not.toBe('yuanwu');
  });
});

describe('L06 无光领域（启动）', () => {
  it('发动：先受 4 点自伤 → 设定攻击点数 ±1（含钳制）；本回合只能启动一次', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L06', heroA: ['016', '017', '018'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.A.life = 40;
    g.players.A.lifeTens = 4;
    const has = (): boolean =>
      getLegalActions(g).some((a) => a.t === 'skill' && a.artifactId === 'L06');
    expect(has()).toBe(true);
    applyAction(g, { t: 'skill', artifactId: 'L06', side: 'only', params: { choice: 'up' } });
    expect(g.players.A.life).toBe(36); // 自伤 4
    expect(g.players.A.wuguang).toBe('up');
    expect(has()).toBe(false); // 启动：每回合一次
    // 攻击点数 ±1（作用于 baseValue，含钳制）
    g.pendingAttack = null;
    virtualAttack(g, 'A', 3);
    expect(g.pendingAttack!.baseValue).toBe(4);
    g.pendingAttack = null;
    virtualAttack(g, 'A', 6);
    expect(g.pendingAttack!.baseValue).toBe(6); // 上限 6
    g.pendingAttack = null;
    g.players.A.wuguang = 'down';
    virtualAttack(g, 'A', 1);
    expect(g.pendingAttack!.baseValue).toBe(1); // 下限 1
  });
});

describe('L06 面板动作携带 legendKey（引擎按 key 精确解析）', () => {
  it('动作带 legendKey=xiu.wuguanglingyu；选②下降 → 生效', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L06', heroA: ['016', '017', '018'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    const act = getLegalActions(g).find((a) => a.t === 'skill' && a.artifactId === 'L06')!;
    expect((act as { params?: { legendKey?: string } }).params?.legendKey).toBe('xiu.wuguanglingyu');
    g.players.A.life = 40;
    g.players.A.lifeTens = 4;
    applyAction(g, {
      t: 'skill',
      artifactId: 'L06',
      side: 'only',
      params: { legendKey: 'xiu.wuguanglingyu', choice: 'down' },
    });
    expect(g.players.A.wuguang).toBe('down');
    expect(g.players.A.life).toBe(36);
  });
});

describe('L06 死即新生（持续）', () => {
  it('因自己造成的伤害死亡 → 生命重设为 13、上限不变、不判负', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L06', heroA: ['016', '017', '018'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.A.life = 5;
    g.players.A.lifeTens = 0;
    dealTrueDamage(g, 'A', 10, 'A');
    expect(g.players.A.life).toBe(13);
    expect(g.players.A.lifeMax).toBe(45); // 018 至黑 life 45
    expect(g.phase).not.toBe('gameOver');
  });

  it('因对方造成的伤害死亡 → 不触发（正常判负）', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L06', heroA: ['016', '017', '018'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.A.life = 5;
    dealTrueDamage(g, 'A', 10, 'B');
    expect(g.phase).toBe('gameOver');
  });

  it('触发时发 skillFired（死即新生）', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L06', heroA: ['016', '017', '018'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.A.life = 5;
    fxReset();
    dealTrueDamage(g, 'A', 10, 'A');
    expect(fxTake().some((e) => e.kind === 'skillFired' && e.skillKey === 'xiu.sijixinsheng')).toBe(true);
  });
});

describe('L05 复仇之灵 · 非当前回合玩家的强制尘起（作者裁定 2026-09-27）', () => {
  /** 把待决策跑完（用引擎给的默认/首选合法动作） */
  const drain = (g: GameState): void => {
    let guard = 0;
    while (g.pending && guard++ < 12) applyAction(g, getLegalActions(g)[0]);
  };

  it('对方回合被迫尘起激活 014「惩戒」→ 回到自己回合后激活标志保留、仍可正常使用（可切换）', () => {
    const g = setupGame({
      seed: 1,
      firstPlayer: 'B', // 先 B 的回合，A 之后才开始自己的回合
      legendA: 'L05',
      heroA: ['013', '014', '015'],
      heroB: ['004', '005', '006'],
    });
    g.activePlayer = 'B';
    g.phase = 'main';
    g.players.A.life = 40; // 避免 014「净化」自伤把生命十位数打变 → 触发额外的复仇之灵
    g.pending = { kind: 'fuchouRise', player: 'A' };

    // A（非当前回合玩家）做强制尘起：激活 014 左侧（"激活"类 → 装填瞬间立即强制结算）
    applyAction(g, { t: 'dustRise', artifactId: '014', side: 'left', free: true, fuchou: true });
    drain(g);

    const a14 = g.players.A.artifacts.find((a) => a.id === '014')!;
    expect(g.pending).toBeNull(); // 强制尘起用掉
    expect(g.activePlayer).toBe('B'); // 仍然是 B 的回合
    expect(a14.activeMarkerSide).toBe('left');

    // B 的回合结束 → A 的回合开始：激活标志**必须保留**（回合开始的重置不碰 activeMarkerSide）
    endTurn(g);
    expect(g.activePlayer).toBe('A');
    expect(a14.activeMarkerSide).toBe('left');
    // 仍可正常使用：014 仍是合法尘起目标（可切走/切回 → 重新装填会再次立即结算）
    expect(canTargetForDustRise(a14)).toBe(true);
    g.phase = 'dustRise';
    g.players.A.areas.meditation.push(die('m1', 1, 'meditation'));
    expect(
      getLegalActions(g).some((a) => a.t === 'dustRise' && a.artifactId === '014' && !a.free),
    ).toBe(true);
  });
});

describe('L07 无尽追猎（持续）', () => {
  const l07Game = (heroA: [string, string, string] = ['019', '020', '021']) =>
    setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L07', heroA, heroB: ['004', '005', '006'] });

  it('攻击骰区恰剩 1 颗 → 本次攻击不可抵挡；多于 1 颗 → 正常可抵挡', () => {
    const g = l07Game();
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.A.areas.attack = [die('a1', 3, 'attack')];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    expect(g.pendingAttack?.unblockable).toBe(true);

    const g2 = l07Game();
    g2.phase = 'main';
    g2.activePlayer = 'A';
    g2.players.A.areas.attack = [die('a1', 3, 'attack'), die('a2', 4, 'attack')];
    applyAction(g2, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    expect(g2.pendingAttack?.unblockable).toBe(false);
  });

  it('§19⑨e：与 013「电刑」联动——实体那一次不可抵挡，虚拟三段仍可抵挡', () => {
    const g = l07Game(['013', '020', '021']); // 合成组合：只为覆盖交互（预设下 L07 三件套无 013）
    g.phase = 'main';
    g.activePlayer = 'A';
    const p = g.players.A;
    p.artifacts.find((a) => a.id === '013')!.activeMarkerSide = 'left'; // 电刑（触发·左）
    p.areas.attack = [die('a1', 5, 'attack')];
    p.areas.meditation = [die('m1', 2, 'meditation'), die('m2', 3, 'meditation')];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    expect(g.pendingAttack?.unblockable).toBe(true);
    applyAction(g, { t: 'block' }); // B 不抵挡 → 结算 → 排队「电刑」
    expect(g.pending?.kind).toBe('dianxing');
    const pay = getLegalActions(g).find(
      (a) => a.t === 'dianxing' && (a as { dieIds?: string[] }).dieIds?.length === 2,
    )!;
    applyAction(g, pay);
    // 第 1 段虚拟攻击（1 点）：没有实体攻击骰 → 不受「无尽追猎」影响
    expect(g.pendingAttack?.baseValue).toBe(1);
    expect(g.pendingAttack?.unblockable).toBe(false);
  });

  it('§19⑨e：与 A01「不败之王」联动——技能发起的虚拟攻击不受影响（仍可抵挡）', () => {
    const g = l07Game(['A01', '020', '021']);
    g.phase = 'dustRise';
    g.activePlayer = 'A';
    const a01 = g.players.A.artifacts.find((a) => a.id === 'A01')!;
    a01.chargeLayer = (a01.chargeReq ?? 3) - 1; // 差 1 层 → 下一次充能触发「不败之王」
    g.players.A.areas.meditation = [die('m1', 3, 'meditation')];
    applyAction(g, { t: 'dustRise', artifactId: 'A01', costSlots: [{ dieIds: ['m1'] }] });
    expect(g.pendingAttack).not.toBeNull();
    expect(g.pendingAttack?.unblockable).toBe(false);
  });
});

describe('L07 始祖兽魂（触发）', () => {
  const l07Game = () => setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L07', heroA: ['019', '020', '021'], heroB: ['004', '005', '006'] });

  it('激活「兽魂」→ 弹「是否额外消耗 1 个冥想骰（计数改为 3）」；付 → 3，不发动 → 2', () => {
    // 付：两个冥想骰（一个付尘起、一个付额外消耗）
    const g = l07Game();
    g.phase = 'dustRise';
    g.activePlayer = 'A';
    const s = g.players.A.artifacts.find((a) => a.id === '020')!;
    g.players.A.areas.meditation = [die('m1', 2, 'meditation'), die('m2', 4, 'meditation')];
    applyAction(g, { t: 'dustRise', artifactId: '020', side: 'left', costSlots: [{ dieIds: ['m1'] }] });
    expect(s.activeMarkerSide).toBe('left');
    expect(s.count).toBe(2);
    expect(g.pending?.kind).toBe('shizushouhun');
    applyAction(g, { t: 'shizushouhun', accept: true, costSlots: [{ dieIds: ['m2'] }] });
    expect(s.count).toBe(3);
    expect(g.players.A.areas.meditation).toHaveLength(0); // 两颗都被消耗

    // 不发动：只有 1 颗冥想骰（付完尘起后无可付） → 不弹待决策、计数保持 2
    const g2 = l07Game();
    g2.phase = 'dustRise';
    g2.activePlayer = 'A';
    const s2 = g2.players.A.artifacts.find((a) => a.id === '020')!;
    g2.players.A.areas.meditation = [die('m1', 2, 'meditation')];
    applyAction(g2, { t: 'dustRise', artifactId: '020', side: 'left', costSlots: [{ dieIds: ['m1'] }] });
    expect(s2.count).toBe(2);
    expect(g2.pending).toBeNull();
  });

  it('每次「激活兽魂」都询问（切到另一侧再激活 → 第二次仍会问）', () => {
    const g = l07Game();
    g.phase = 'dustRise';
    g.activePlayer = 'A';
    const s = g.players.A.artifacts.find((a) => a.id === '020')!;
    g.players.A.areas.meditation = [
      die('m1', 2, 'meditation'),
      die('m2', 4, 'meditation'),
      die('m3', 5, 'meditation'),
      die('m4', 6, 'meditation'),
    ];
    applyAction(g, { t: 'dustRise', artifactId: '020', side: 'left', costSlots: [{ dieIds: ['m1'] }] });
    expect(g.pending?.kind).toBe('shizushouhun');
    applyAction(g, { t: 'shizushouhun', accept: false }); // 不发动
    expect(s.count).toBe(2);
    g.dustRiseNormalCount = 0; // 模拟"另一个尘起阶段"（每阶段正常 1 次）
    g.phase = 'dustRise'; // 上一个尘起阶段已被"没得做就自动翻页"收口 → 显式回到尘起阶段
    applyAction(g, { t: 'dustRise', artifactId: '020', side: 'right', costSlots: [{ dieIds: ['m2'] }] });
    expect(s.activeMarkerSide).toBe('right');
    expect(g.pending?.kind).toBe('shizushouhun'); // 第二次激活同样询问
    applyAction(g, { t: 'shizushouhun', accept: true, costSlots: [{ dieIds: ['m3'] }] });
    expect(s.count).toBe(3);
  });

  it('切换同样「重设计数 + 询问」：左（3）→ 切右（还有第二颗冥想骰）→ 计数 = 2 且弹询问 → 付 → 3', () => {
    const g = l07Game();
    g.phase = 'dustRise';
    g.activePlayer = 'A';
    const s = g.players.A.artifacts.find((a) => a.id === '020')!;
    g.players.A.areas.meditation = [
      die('m1', 2, 'meditation'),
      die('m2', 4, 'meditation'),
      die('m3', 1, 'meditation'),
      die('m4', 6, 'meditation'),
    ];
    // 首次激活：付 → 3
    applyAction(g, { t: 'dustRise', artifactId: '020', side: 'left', costSlots: [{ dieIds: ['m1'] }] });
    applyAction(g, { t: 'shizushouhun', accept: true, costSlots: [{ dieIds: ['m2'] }] });
    expect(s.count).toBe(3);
    // 切换到另一侧（付费）：先重设为 2，再询问；付 → 3
    g.dustRiseNormalCount = 0; // 模拟"另一个尘起阶段"
    g.phase = 'dustRise'; // 上一个尘起阶段已被"没得做就自动翻页"收口 → 显式回到尘起阶段
    applyAction(g, { t: 'dustRise', artifactId: '020', side: 'right', costSlots: [{ dieIds: ['m3'] }] });
    expect(s.activeMarkerSide).toBe('right');
    expect(s.count).toBe(2); // ← 切换重设计数（不是保留 3）
    expect(g.pending?.kind).toBe('shizushouhun'); // ← 切换同样询问
    applyAction(g, { t: 'shizushouhun', accept: true, costSlots: [{ dieIds: ['m4'] }] });
    expect(s.count).toBe(3);
  });

  it('切换时若付不出（无第二颗冥想骰）→ 不弹询问，但计数仍重设为 2', () => {
    const g = l07Game();
    g.phase = 'dustRise';
    g.activePlayer = 'A';
    const s = g.players.A.artifacts.find((a) => a.id === '020')!;
    g.players.A.areas.meditation = [die('m1', 2, 'meditation'), die('m2', 4, 'meditation')];
    applyAction(g, { t: 'dustRise', artifactId: '020', side: 'left', costSlots: [{ dieIds: ['m1'] }] });
    applyAction(g, { t: 'shizushouhun', accept: true, costSlots: [{ dieIds: ['m2'] }] });
    expect(s.count).toBe(3);
    // 手上只剩 1 颗冥想骰：付完切换就没有可付的了
    g.players.A.areas.meditation = [die('m3', 1, 'meditation')];
    g.dustRiseNormalCount = 0;
    g.phase = 'dustRise'; // 上一个尘起阶段已被"没得做就自动翻页"收口 → 显式回到尘起阶段
    applyAction(g, { t: 'dustRise', artifactId: '020', side: 'right', costSlots: [{ dieIds: ['m3'] }] });
    expect(s.activeMarkerSide).toBe('right');
    expect(s.count).toBe(2); // 仍然重设为 2
    expect(g.pending).toBeNull(); // 付不出 → 不打扰
  });
});

describe('L07 不屈咆哮（必杀·尘落前置 2）', () => {
  const l07Game = (legendB?: string, heroB: [string, string, string] = ['004', '005', '006']) =>
    setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L07', heroA: ['019', '020', '021'], legendB, heroB });

  const hasUlt = (g: GameState): boolean =>
    getLegalActions(g).some(
      (a) =>
        a.t === 'skill' &&
        a.artifactId === 'L07' &&
        (a as { params?: { legendKey?: string } }).params?.legendKey === 'nisa.buqupaoxiao',
    );

  it('尘落 <2 → 不给按钮；尘落 ≥2 但「决意」计数 0 → 也不给；两者都满足 → 可发动', () => {
    const g = l07Game();
    g.phase = 'main';
    g.activePlayer = 'A';
    const jy = g.players.A.artifacts.find((a) => a.id === '021')!;
    g.dustfall = 1;
    expect(hasUlt(g)).toBe(false);
    g.dustfall = 2;
    expect(hasUlt(g)).toBe(false); // 决意计数 0
    jy.activeMarkerSide = 'left';
    jy.count = 3;
    expect(hasUlt(g)).toBe(true);
  });

  it('弃置对方数量＝「决意」当前计数（跨类型一次），随后「决意」计数重设为 1；整局一次', () => {
    const g = l07Game();
    g.phase = 'main';
    g.activePlayer = 'A';
    g.dustfall = 2;
    const jy = g.players.A.artifacts.find((a) => a.id === '021')!;
    jy.activeMarkerSide = 'left';
    jy.count = 3;
    g.players.B.areas.attack = [die('b1', 1, 'attack')];
    g.players.B.areas.defense = [die('b2', 2, 'defense')];
    g.players.B.areas.meditation = [die('b3', 3, 'meditation'), die('b4', 4, 'meditation')];
    applyAction(g, {
      t: 'skill',
      artifactId: 'L07',
      side: 'only',
      params: { legendKey: 'nisa.buqupaoxiao', dieIds: ['b1', 'b2', 'b3'] },
    });
    expect(g.players.B.areas.attack).toHaveLength(0);
    expect(g.players.B.areas.defense).toHaveLength(0);
    expect(g.players.B.areas.meditation.map((d) => d.id)).toEqual(['b4']);
    expect(jy.count).toBe(1);
    expect(g.ultimatesUsed).toContain('A:nisa.buqupaoxiao');
    expect(hasUlt(g)).toBe(false); // 整局一次
  });

  it('对方能力骰不足 → 全弃；且对方「雨落狂流」按**一次效果**只 +1（跨类型批量）', () => {
    const g = l07Game('L01', ['001', '002', '003']); // B 持 L01：B 的分布＝002（攻[3,4] 防[1,6] 冥[2,5]）
    g.phase = 'main';
    g.activePlayer = 'A';
    g.dustfall = 2;
    const jy = g.players.A.artifacts.find((a) => a.id === '021')!;
    jy.activeMarkerSide = 'left';
    jy.count = 5; // 想弃 5，但对方只有 2 颗 → 全弃
    g.players.B.areas.attack = [die('b1', 1, 'attack')]; // 1 ∉ {3,4} → 不符合分布
    g.players.B.areas.defense = [];
    g.players.B.areas.meditation = [die('b2', 1, 'meditation')]; // 1 ∉ {2,5} → 不符合分布
    applyAction(g, {
      t: 'skill',
      artifactId: 'L07',
      side: 'only',
      params: { legendKey: 'nisa.buqupaoxiao', dieIds: ['b1', 'b2'] },
    });
    expect(g.players.B.areas.attack).toHaveLength(0);
    expect(g.players.B.areas.meditation).toHaveLength(0);
    expect(g.players.B.legend!.count).toBe(1); // 一次效果（跨类型）只 +1
    expect(jy.count).toBe(1);
  });
});

describe('L08 蛇蝎之泪（持续）', () => {
  const l08Game = () =>
    setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L08', heroA: ['022', '023', '024'], heroB: ['004', '005', '006'] });

  it('每次「填弹」后：受到「本回合累计叠加量²」的真实伤害（按实际增量，含上限封顶）', () => {
    const g = l08Game();
    g.phase = 'main';
    g.activePlayer = 'A';
    const p = g.players.A;
    p.artifacts.find((a) => a.id === '022')!.activeMarkerSide = 'left'; // 填弹（启动·左）
    p.areas.attack = [die('a1', 2, 'attack')];
    const l0 = p.life;
    applyAction(g, { t: 'skill', artifactId: '022', side: 'left', params: { dieIds: ['a1'] } });
    expect(p.tiandanGainedThisTurn).toBe(1);
    expect(p.life).toBe(l0 - 1); // 1² = 1

    // 模拟"本回合此前已叠加 2"（正常由「赏金」再启动一次填弹达成，见下一组用例）→ 再加 1 → 累计 3 → 3² = 9
    p.tiandanGainedThisTurn = 2;
    g.skillsUsedThisTurn = [];
    p.areas.attack = [die('a2', 5, 'attack')];
    const l1 = p.life;
    applyAction(g, { t: 'skill', artifactId: '022', side: 'left', params: { dieIds: ['a2'] } });
    expect(p.tiandanGainedThisTurn).toBe(3);
    expect(p.life).toBe(l1 - 9);
  });

  it('计数已满 6：按**实际增量 0** 计 → 不受伤', () => {
    const g = l08Game();
    g.phase = 'main';
    g.activePlayer = 'A';
    const p = g.players.A;
    const c = p.artifacts.find((a) => a.id === '022')!;
    c.activeMarkerSide = 'left';
    c.count = 6; // 已满
    p.areas.attack = [die('a1', 2, 'attack')];
    const l0 = p.life;
    applyAction(g, { t: 'skill', artifactId: '022', side: 'left', params: { dieIds: ['a1'] } });
    expect(c.count).toBe(6);
    expect(p.tiandanGainedThisTurn).toBe(0);
    expect(p.life).toBe(l0);
  });

  it('回合开始清零；不带 L08 时不自伤', () => {
    const g = l08Game();
    g.players.A.tiandanGainedThisTurn = 4;
    beginTurn(g);
    expect(g.players.A.tiandanGainedThisTurn).toBe(0);

    const g2 = setupGame({ seed: 1, firstPlayer: 'A', heroA: ['022', '023', '024'], heroB: ['004', '005', '006'] });
    g2.phase = 'main';
    g2.activePlayer = 'A';
    const p2 = g2.players.A;
    p2.artifacts.find((a) => a.id === '022')!.activeMarkerSide = 'left';
    p2.areas.attack = [die('a1', 2, 'attack')];
    const l = p2.life;
    applyAction(g2, { t: 'skill', artifactId: '022', side: 'left', params: { dieIds: ['a1'] } });
    expect(p2.life).toBe(l);
  });
});

describe('L08 只为赏金而来（触发）', () => {
  const l08Game = () =>
    setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L08', heroA: ['022', '023', '024'], heroB: ['004', '005', '006'] });

  /** 让 A 用 1 个攻击骰发动攻击 → 弹出处刑通牒；再按 pick 决定 */
  const startAttack = (
    g: GameState,
    pick: 'none' | 'unblockable' | 'bonus5',
  ): void => {
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    applyAction(g, { t: 'chuxingPick', pick });
  };

  it('**实际发动**「处刑通牒」后弹出「赏金」；不发动则不清空/可跳过；不发动处刑通牒则不弹', () => {
    const g = l08Game();
    g.phase = 'main';
    g.activePlayer = 'A';
    const p = g.players.A;
    const siji = p.artifacts.find((a) => a.id === '022')!;
    siji.activeMarkerSide = 'right'; // 处刑通牒（触发·右）
    siji.count = 1;
    p.areas.attack = [die('a1', 3, 'attack')];
    startAttack(g, 'bonus5');
    expect(siji.count).toBe(0);
    expect(g.pendingAttack).not.toBeNull(); // 攻击已生成（正在等抵挡）
    expect(g.pending?.kind).toBe('shangjin');
    applyAction(g, { t: 'shangjin', decline: true });
    expect(g.pending).toBeNull();

    // 对照：处刑通牒选"不发动" → 不弹赏金
    const g2 = l08Game();
    g2.phase = 'main';
    g2.activePlayer = 'A';
    const p2 = g2.players.A;
    const s2 = p2.artifacts.find((a) => a.id === '022')!;
    s2.activeMarkerSide = 'right';
    s2.count = 1;
    p2.areas.attack = [die('a1', 3, 'attack')];
    startAttack(g2, 'none');
    expect(g2.pending?.kind).not.toBe('shangjin');
  });

  it('赏金启动「启动式」技能**不计入**每回合上限：该技能本回合已用过仍可再启动，且不写入已用记录', () => {
    const g = l08Game();
    g.phase = 'main';
    g.activePlayer = 'A';
    const p = g.players.A;
    const siji = p.artifacts.find((a) => a.id === '022')!;
    siji.activeMarkerSide = 'right';
    siji.count = 1;
    p.artifacts.find((a) => a.id === '023')!.activeMarkerSide = 'left'; // 畏惧（启动·左）
    p.areas.attack = [die('a1', 3, 'attack')];
    p.areas.meditation = [die('m1', 3, 'meditation')];
    g.players.B.areas.defense = [die('bd1', 2, 'defense')]; // 畏惧要求对方有能力骰
    g.skillsUsedThisTurn.push('A:shexie.weiju'); // 本回合已用过一次

    startAttack(g, 'unblockable');
    expect(g.pending?.kind).toBe('shangjin');
    const before = g.skillsUsedThisTurn.filter((k) => k === 'A:shexie.weiju').length;
    applyAction(g, {
      t: 'skill',
      artifactId: '023',
      side: 'left',
      params: { costSlots: [{ dieIds: ['m1'] }] },
    });
    expect(g.skillsUsedThisTurn.filter((k) => k === 'A:shexie.weiju').length).toBe(before); // 不计入
    expect(g.pending?.kind).toBe('weijuPay'); // 畏惧已结算 → 对方必须弃 1 颗
  });

  it('赏金只能启动"启动式"：把必杀动作塞进来会抛错（非法动作不改状态）', () => {
    const g = l08Game();
    g.phase = 'main';
    g.activePlayer = 'A';
    const p = g.players.A;
    const siji = p.artifacts.find((a) => a.id === '022')!;
    siji.activeMarkerSide = 'right';
    siji.count = 1;
    p.areas.attack = [die('a1', 3, 'attack')];
    startAttack(g, 'bonus5');
    expect(g.pending?.kind).toBe('shangjin');
    expect(() =>
      applyAction(g, { t: 'skill', artifactId: '024', side: 'only', params: { direction: 'cw', groups: [[], [], [], [], [], []] } }),
    ).toThrow();
    expect(g.pending?.kind).toBe('shangjin'); // 非法动作不改变状态
  });
});

describe('L08 没有怜悯（持续·尘落前置 4）', () => {
  const l08Game = () =>
    setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L08', heroA: ['022', '023', '024'], heroB: ['004', '005', '006'] });

  const has024 = (g: GameState): boolean =>
    getLegalActions(g).some((a) => a.t === 'skill' && a.artifactId === '024');

  it('尘落 <4 不给 024 必杀动作；≥4 时**无需充能/激活**即可启动：每次 2 真实伤害、每回合 1 次、不吃「整局一次」', () => {
    const g = l08Game();
    g.phase = 'main';
    g.activePlayer = 'A';
    const p = g.players.A;
    g.dustfall = 3;
    expect(has024(g)).toBe(false);
    g.dustfall = 4;
    expect(has024(g)).toBe(true);

    const l0 = p.life;
    const act: Action = {
      t: 'skill',
      artifactId: '024',
      side: 'only',
      params: { direction: 'cw', groups: [[], [], [], [], [], []] },
    };
    applyAction(g, act);
    expect(p.life).toBe(l0 - 2); // 没有怜悯：2 真实伤害
    expect(g.ultimatesUsed).not.toContain('A:kuangwu.ultimate'); // 不吃整局一次
    expect(g.skillsUsedThisTurn).toContain('A:kuangwu.ultimate'); // 计入"每回合 1 次"
    expect(has024(g)).toBe(false);
    expect(() => applyAction(g, act)).toThrow(); // 同回合第二次 → 非法
  });

  it('对照：不带 L08 时，024 必杀仍需激活（未激活 → 不出现动作）', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', heroA: ['022', '023', '024'], heroB: ['004', '005', '006'] });
    g.phase = 'main';
    g.dustfall = 6;
    expect(has024(g)).toBe(false);
  });
});

describe('L09 吞虎之狼（持续）', () => {
  const l09Game = (heroA: [string, string, string] = ['025', '026', '027']) =>
    setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L09', heroA, heroB: ['004', '005', '006'] });

  it('每个回合的**第 3 次**攻击伤害 +3（第 1/2 次不加）；计数跨回合清零', () => {
    const g = l09Game();
    g.phase = 'main';
    g.activePlayer = 'A';
    const p = g.players.A;
    p.areas.attack = [die('a1', 1, 'attack'), die('a2', 1, 'attack'), die('a3', 1, 'attack')];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    expect(g.pendingAttack?.value).toBe(1); // 第 1 次：无加成
    applyAction(g, { t: 'block' });
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a2'] }] });
    expect(g.pendingAttack?.value).toBe(1); // 第 2 次：吞虎之狼只看第 3 次（025 横贯未激活）
    applyAction(g, { t: 'block' });
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a3'] }] });
    expect(g.pendingAttack?.value).toBe(1 + 3); // 第 3 次：+3
    applyAction(g, { t: 'block' });

    // 跨回合清零：B 的回合开始后计数归零
    g.phase = 'main';
    g.activePlayer = 'B';
    applyAction(g, { t: 'advance' }); // B 结束（推进回合）
    expect(g.attacksThisTurn.A).toBe(0);
  });

  it('**虚拟攻击同样计入**（合成局面：A 持 L09 + 013 电刑 → 第 2 段虚拟＝第 3 次攻击 → +3）', () => {
    const g = l09Game(['013', '026', '027']);
    g.phase = 'main';
    g.activePlayer = 'A';
    const p = g.players.A;
    p.artifacts.find((a) => a.id === '013')!.activeMarkerSide = 'left'; // 电刑
    p.areas.attack = [die('a1', 2, 'attack')];
    p.areas.meditation = [die('m1', 2, 'meditation'), die('m2', 3, 'meditation')];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] }); // 实体＝第 1 次
    applyAction(g, { t: 'block' });
    const pay = getLegalActions(g).find(
      (a) => a.t === 'dianxing' && (a as { dieIds?: string[] }).dieIds?.length === 2,
    )!;
    applyAction(g, pay);
    // 第 1 段虚拟（1 点）＝第 2 次 → 无加成
    expect(g.pendingAttack?.baseValue).toBe(1);
    expect(g.pendingAttack?.value).toBe(1);
    applyAction(g, { t: 'block' });
    // 第 2 段虚拟（2 点）＝第 3 次 → 吞虎之狼 +3
    expect(g.pendingAttack?.baseValue).toBe(2);
    expect(g.pendingAttack?.value).toBe(5);
  });

  it('对照：不带 L09 时第 3 次攻击无 +3', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', heroA: ['025', '026', '027'], heroB: ['004', '005', '006'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    const p = g.players.A;
    p.areas.attack = [die('a1', 1, 'attack'), die('a2', 1, 'attack'), die('a3', 1, 'attack')];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    applyAction(g, { t: 'block' });
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a2'] }] });
    applyAction(g, { t: 'block' });
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a3'] }] });
    expect(g.pendingAttack?.value).toBe(1);
  });
});

describe('L09 鏖战（持续）', () => {
  const l09Game = (heroB: [string, string, string] = ['004', '005', '006']) =>
    setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L09', heroA: ['025', '026', '027'], heroB });

  it('主要阶段结束时：陷阵已激活且自己有能力骰 → 再次执行 1 次「陷阵」（决策人＝生命最低方）', () => {
    const g = l09Game();
    g.phase = 'main';
    g.activePlayer = 'A';
    const p = g.players.A;
    p.artifacts.find((a) => a.id === '026')!.activeMarkerSide = 'left'; // 陷阵（持续·左）
    p.areas.attack = [die('a1', 3, 'attack')];
    p.life = 30;
    g.players.B.life = 40; // 生命最低＝A
    applyAction(g, { t: 'advance' });
    expect(g.pending?.kind).toBe('xianzhenPick');
    expect(g.pending && g.pending.kind === 'xianzhenPick' ? g.pending.player : null).toBe('A'); // 生命最低方决策
    expect(g.pending && g.pending.kind === 'xianzhenPick' ? g.pending.owner : null).toBe('A');
  });

  it('陷阵未激活 / 自己没有能力骰 → 不执行', () => {
    const g = l09Game();
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.A.areas.attack = [die('a1', 3, 'attack')];
    applyAction(g, { t: 'advance' }); // 陷阵未激活
    expect(g.pending?.kind).not.toBe('xianzhenPick');

    const g2 = l09Game();
    g2.phase = 'main';
    g2.activePlayer = 'A';
    g2.players.A.artifacts.find((a) => a.id === '026')!.activeMarkerSide = 'left';
    g2.players.A.areas.attack = [];
    g2.players.A.areas.defense = [];
    g2.players.A.areas.meditation = [];
    applyAction(g2, { t: 'advance' }); // 无能力骰
    expect(g2.pending?.kind).not.toBe('xianzhenPick');
  });

  it('顺序：与「033 死亡亦逝」同点时**鏖战先跑**（按当时骰数判定，不被 033 先弃光）', () => {
    const g = l09Game(['004', '005', '033']); // 对手持 033（艾娃三件套之一）
    g.phase = 'main';
    g.activePlayer = 'A';
    const p = g.players.A;
    p.artifacts.find((a) => a.id === '026')!.activeMarkerSide = 'left';
    const d033 = g.players.B.artifacts.find((a) => a.id === '033')!;
    d033.activeMarkerSide = 'left';
    d033.chargeLayer = d033.chargeReq ?? 0; // 033 生效
    p.areas.attack = [die('a1', 3, 'attack')]; // 只有 1 颗：若 033 先跑会被弃光、鏖战就"饿死"
    applyAction(g, { t: 'advance' });
    expect(g.pending?.kind).toBe('xianzhenPick'); // 鏖战先（否则这里会是 tiaolingPick）
  });
});

describe('L09 遍野残杀（必杀·尘落前置 2）', () => {
  const l09Game = () =>
    setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L09', heroA: ['025', '026', '027'], heroB: ['004', '005', '006'] });

  it('需「三件神器均激活」+ 尘落 ≥2；发动后左右两侧同时生效，回合结束立即死亡（判负）', () => {
    const g = l09Game();
    g.phase = 'main';
    g.activePlayer = 'A';
    const p = g.players.A;
    const has = (): boolean =>
      getLegalActions(g).some((a) => a.t === 'skill' && a.artifactId === 'L09');
    p.artifacts.forEach((a) => {
      a.activeMarkerSide = 'left';
    });
    g.dustfall = 1;
    expect(has()).toBe(false); // 尘落不足
    g.dustfall = 2;
    expect(has()).toBe(true);
    // 拿走 027 的标记 → 不再给按钮（须三件全激活）
    p.artifacts.find((a) => a.id === '027')!.activeMarkerSide = null;
    expect(has()).toBe(false);
    p.artifacts.find((a) => a.id === '027')!.activeMarkerSide = 'left';

    applyAction(g, {
      t: 'skill',
      artifactId: 'L09',
      side: 'only',
      params: { legendKey: 'lifeng.bianyecansha' },
    });
    expect(p.artifacts.every((a) => a.allSidesActiveThisTurn === true)).toBe(true);
    // 左右两侧同时生效
    expect(hasActiveSkill(p, 'tuohu.qixi')).toBe(true);
    expect(hasActiveSkill(p, 'tuohu.hengguan')).toBe(true);
    expect(hasActiveSkill(p, 'aige.xianzhen')).toBe(true);
    expect(hasActiveSkill(p, 'aige.weiya')).toBe(true);
    // 回合结束 → 立即死亡
    p.areas.attack = [];
    p.areas.defense = [];
    p.areas.meditation = [];
    applyAction(g, { t: 'advance' }); // main → end → 交回合时死亡
    expect(g.phase).toBe('gameOver');
    expect(g.winner).toBe('B');
  });

  it('若游戏在回合结束前已结束（对手先被击败）→ 不发生死亡、自己获胜', () => {
    const g = l09Game();
    g.phase = 'main';
    g.activePlayer = 'A';
    const p = g.players.A;
    p.artifacts.forEach((a) => {
      a.activeMarkerSide = 'left';
    });
    g.dustfall = 2;
    applyAction(g, { t: 'skill', artifactId: 'L09', side: 'only', params: { legendKey: 'lifeng.bianyecansha' } });
    dealTrueDamage(g, 'B', 999, 'A'); // 先把对手打死 → gameOver、胜者 A
    expect(g.phase).toBe('gameOver');
    expect(g.winner).toBe('A');
    const lifeBefore = p.life;
    endTurn(g); // 已 gameOver → endTurn 直接返回，不发生死亡
    expect(p.life).toBe(lifeBefore);
    expect(g.winner).toBe('A');
  });

  it('"左右两侧视为激活"标志**常驻**（回合开始不再清除；只有实际触发死亡/重开一局才结束）', () => {
    const g = l09Game();
    const p = g.players.A;
    p.artifacts.forEach((a) => {
      a.allSidesActiveThisTurn = true;
    });
    beginTurn(g);
    expect(p.artifacts.every((a) => a.allSidesActiveThisTurn === true)).toBe(true); // 常驻，不再被回合开始清除
  });
});

describe('L10 迟来的正义（持续）', () => {
  const l10Game = () =>
    setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L10', heroA: ['028', '029', '030'], heroB: ['004', '005', '006'] });

  it('攻击伤害 +X（X＝尘落，最大 4）；与其它加成**取最大**（030 寰宇飞升 +3 被 +4 盖过）', () => {
    const g = l10Game();
    g.phase = 'main';
    g.activePlayer = 'A';
    g.dustfall = 0;
    g.players.A.areas.attack = [die('a1', 1, 'attack')];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    expect(g.pendingAttack?.value).toBe(1); // 尘落 0 → 迟来的正义 +0（030 的 +3 也不适用？→ 见下）
    applyAction(g, { t: 'block' });

    // 尘落 4 → +4（与 030 寰宇飞升第 1 次 +3 取最大 → 只 +4）
    const g2 = l10Game();
    g2.phase = 'main';
    g2.activePlayer = 'A';
    g2.dustfall = 4;
    g2.players.A.areas.attack = [die('a1', 1, 'attack')];
    applyAction(g2, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    expect(g2.pendingAttack?.value).toBe(1 + 4);
    expect(g2.pendingAttack?.bonusLabel).toBe('迟来的正义');

    // 尘落 7 也按 4 封顶
    const g3 = l10Game();
    g3.phase = 'main';
    g3.activePlayer = 'A';
    g3.dustfall = 7;
    g3.players.A.areas.attack = [die('a1', 1, 'attack')];
    applyAction(g3, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    expect(g3.pendingAttack?.value).toBe(1 + 4);
  });
});

describe('L10 涤罪大剑术（触发）', () => {
  const l10Game = () =>
    setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L10', heroA: ['028', '029', '030'], heroB: ['004', '005', '006'] });

  it('尘起后：第一/二列标记同侧 + 对方有两种以上骰 → 弹询问；选 2 颗种类不同 → 弃置', () => {
    const g = l10Game();
    g.phase = 'dustRise';
    g.activePlayer = 'A';
    const p = g.players.A;
    p.artifacts.find((a) => a.id === '028')!.activeMarkerSide = 'left'; // 第一列已在左
    p.areas.meditation = [die('m1', 3, 'meditation')];
    g.players.B.areas.attack = [die('b1', 1, 'attack')];
    g.players.B.areas.defense = [die('b2', 2, 'defense')];
    // 把第二列（029）也尘起到左 → 两侧同侧 → 触发
    applyAction(g, { t: 'dustRise', artifactId: '029', side: 'left', costSlots: [{ dieIds: ['m1'] }] });
    expect(p.artifacts.find((a) => a.id === '029')!.activeMarkerSide).toBe('left');
    expect(g.pending?.kind).toBe('dizuidaijianshu');
    applyAction(g, { t: 'dizuidaijianshu', dieIds: ['b1', 'b2'] });
    expect(g.players.B.areas.attack).toHaveLength(0);
    expect(g.players.B.areas.defense).toHaveLength(0);
  });

  it('标记不同侧 / 对方只有一种骰 / 不发动 → 行为正确', () => {
    // 不同侧：028 左、029 右 → 不触发
    const g = l10Game();
    g.phase = 'dustRise';
    g.activePlayer = 'A';
    g.players.A.artifacts.find((a) => a.id === '028')!.activeMarkerSide = 'left';
    g.players.A.artifacts.find((a) => a.id === '029')!.activeMarkerSide = 'right';
    g.players.A.areas.meditation = [die('m1', 3, 'meditation')];
    g.players.B.areas.attack = [die('b1', 1, 'attack')];
    g.players.B.areas.defense = [die('b2', 2, 'defense')];
    applyAction(g, { t: 'dustRise', artifactId: '030', costSlots: [{ dieIds: ['m1'] }] });
    expect(g.pending?.kind).not.toBe('dizuidaijianshu');

    // 同侧但对方只有一种骰 → 不弹
    const g2 = l10Game();
    g2.phase = 'dustRise';
    g2.activePlayer = 'A';
    const p2 = g2.players.A;
    p2.artifacts.find((a) => a.id === '028')!.activeMarkerSide = 'left';
    p2.areas.meditation = [die('m1', 3, 'meditation')];
    g2.players.B.areas.attack = [die('b1', 1, 'attack')];
    g2.players.B.areas.defense = [];
    g2.players.B.areas.meditation = [];
    applyAction(g2, { t: 'dustRise', artifactId: '029', side: 'left', costSlots: [{ dieIds: ['m1'] }] });
    expect(g2.pending?.kind).not.toBe('dizuidaijianshu');
  });

  it('两颗骰种类相同 → 非法（不改状态）；对方若持 L01「雨落狂流」，弃置 2 颗**只 +1**', () => {
    const g = setupGame({
      seed: 1,
      firstPlayer: 'A',
      legendA: 'L10',
      legendB: 'L01',
      heroA: ['028', '029', '030'],
      heroB: ['001', '002', '003'],
    });
    g.phase = 'dustRise';
    g.activePlayer = 'A';
    const p = g.players.A;
    p.artifacts.find((a) => a.id === '028')!.activeMarkerSide = 'left';
    p.areas.meditation = [die('m1', 3, 'meditation')];
    // B 的分布＝002：攻[3,4] 防[1,6] 冥[2,5] → 1 点攻击/1 点冥想都"不符合分布"，但种类不同
    g.players.B.areas.attack = [die('b1', 1, 'attack'), die('b1b', 1, 'attack')];
    g.players.B.areas.meditation = [die('b2', 1, 'meditation')];
    applyAction(g, { t: 'dustRise', artifactId: '029', side: 'left', costSlots: [{ dieIds: ['m1'] }] });
    expect(g.pending?.kind).toBe('dizuidaijianshu');
    // 种类相同 → 抛错且状态不变
    expect(() => applyAction(g, { t: 'dizuidaijianshu', dieIds: ['b1', 'b1b'] })).toThrow();
    expect(g.pending?.kind).toBe('dizuidaijianshu');
    // 种类不同 → 弃置；B 的 L01 只 +1
    applyAction(g, { t: 'dizuidaijianshu', dieIds: ['b1', 'b2'] });
    expect(g.players.B.legend!.count).toBe(1);
  });
});

describe('L10 汝等罪人（触发）', () => {
  const l10Game = () =>
    setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L10', heroA: ['028', '029', '030'], heroB: ['004', '005', '006'] });

  it('将要回复生命时：排询问（amount＝名义量，不因生命上限削减）；不发动 → 只按上限回复', () => {
    const g = l10Game();
    g.phase = 'main';
    g.activePlayer = 'A';
    const p = g.players.A;
    p.life = p.lifeMax - 2; // 实际只能回复 2
    const healed = heal(g, 'A', 5);
    expect(healed).toBe(0); // 已挂起
    expect(g.pending?.kind).toBe('nudengzuiren');
    expect(g.pending && g.pending.kind === 'nudengzuiren' ? g.pending.amount : -1).toBe(5); // 名义量（不是 2）
    applyAction(g, { t: 'nudengzuiren', accept: false });
    expect(p.life).toBe(p.lifeMax); // 正常回复：受上限封顶 → 只回 2
  });

  it('满血（无可回复空间）也触发；名义量正常，不发动则回 0', () => {
    const g = l10Game();
    g.phase = 'main';
    g.activePlayer = 'A';
    const p = g.players.A;
    p.life = p.lifeMax; // 满血
    const healed = heal(g, 'A', 4);
    expect(healed).toBe(0); // 挂起（满血也触发）
    expect(g.pending && g.pending.kind === 'nudengzuiren' ? g.pending.amount : -1).toBe(4);
    applyAction(g, { t: 'nudengzuiren', accept: false });
    expect(p.life).toBe(p.lifeMax); // 回复 0
  });

  it('发动：不回复、改为对对方造成等量真实伤害（自伤口径不走；source＝你）', () => {
    const g = l10Game();
    g.phase = 'main';
    g.activePlayer = 'A';
    const p = g.players.A;
    p.life = p.lifeMax - 3;
    const bLife = g.players.B.life;
    const healed = heal(g, 'A', 3);
    expect(healed).toBe(0);
    const pd = g.pending;
    expect(pd?.kind).toBe('nudengzuiren');
    applyAction(g, { t: 'nudengzuiren', accept: true });
    expect(p.life).toBe(p.lifeMax - 3); // 没有回复
    expect(g.players.B.life).toBe(bLife - 3); // 对方吃 3 真伤
  });

  it('满血发动：名义量真伤照打（不因满血而削减）', () => {
    const g = l10Game();
    g.phase = 'main';
    g.activePlayer = 'A';
    const p = g.players.A;
    p.life = p.lifeMax;
    const bLife = g.players.B.life;
    heal(g, 'A', 6);
    applyAction(g, { t: 'nudengzuiren', accept: true });
    expect(p.life).toBe(p.lifeMax); // 不回复
    expect(g.players.B.life).toBe(bLife - 6); // 名义量 6 真伤
  });

  it('对照：不带 L10 时回复照常（heal 直接生效）', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', heroA: ['028', '029', '030'], heroB: ['004', '005', '006'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    const p = g.players.A;
    p.life = p.lifeMax - 5;
    expect(heal(g, 'A', 3)).toBe(3);
    expect(g.pending).toBeNull();
  });
});

/** 直接跑某个技能处理器（不经 UI/选择器），用于驱动"非动作"技能（如 033 抹零） */
const runSkill = (
  g: GameState,
  who: PlayerId,
  id: string,
  key: string,
  params: Record<string, unknown> = {},
): void => {
  SKILL_HANDLERS[key].run({
    g,
    player: who,
    artifact: g.players[who].artifacts.find((a) => a.id === id)!,
    rng: new SeededRng(1),
    params,
    endMainPhase: () => {},
    reportConsumed: () => {},
  });
};

describe('L11 强加之罪（持续）', () => {
  it('意志始终为 6（覆盖基础与补正；不影响对手）', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L11', heroA: ['031', '032', '033'], heroB: ['004', '005', '006'] });
    expect(effectiveWill(g.players.A)).toBe(6);
    g.players.A.buffs.push({ attr: 'will', add: 5, duration: 'thisTurn' });
    expect(effectiveWill(g.players.A)).toBe(6); // 补正也被覆盖
    expect(effectiveWill(g.players.B)).not.toBe(6);
  });
});

describe('L11 邪灵序曲（持续）', () => {
  const l11Game = () =>
    setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L11', heroA: ['031', '032', '033'], heroB: ['004', '005', '006'] });

  it('计数：伤害 / 真实伤害 / 抹零 的生命下降都叠加（含自己）；上限 99', () => {
    const g = l11Game();
    g.phase = 'main';
    g.activePlayer = 'A';
    const lg = g.players.A.legend!;
    expect(lg.countCap).toBe(99);
    expect(lg.count).toBe(0);
    g.players.B.life = 500;
    dealTrueDamage(g, 'B', 7, 'A');
    expect(lg.count).toBe(7); // 对方下降
    dealTrueDamage(g, 'A', 3, 'A'); // 自己下降（自伤）也算
    expect(lg.count).toBe(10);
    g.players.B.life = 17;
    runSkill(g, 'A', '033', 'diaoling.charge'); // 抹零：17 → 10（非伤害下降）
    expect(g.players.B.life).toBe(10);
    expect(lg.count).toBe(10 + 7);
    dealTrueDamage(g, 'B', 60, 'A');
    dealTrueDamage(g, 'B', 60, 'A');
    expect(lg.count).toBe(99); // 封顶 99
  });

  it('个位已 0 → 生命不变 → 不计数（FAQ 33.1.2）', () => {
    const g = l11Game();
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.B.life = 40;
    runSkill(g, 'A', '033', 'diaoling.charge');
    expect(g.players.B.life).toBe(40);
    expect(g.players.A.legend!.count).toBe(0);
  });

  it('回合结束：对对手造成 floor(计数/10) 真实伤害；个位为 0 时不造成', () => {
    const g = l11Game();
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.A.areas = { attack: [], defense: [], meditation: [] };
    g.players.A.legend!.count = 37;
    const before = g.players.B.life;
    applyAction(g, { t: 'advance' });
    expect(g.players.B.life).toBe(before - 3);

    const g2 = l11Game();
    g2.phase = 'main';
    g2.activePlayer = 'A';
    g2.players.A.areas = { attack: [], defense: [], meditation: [] };
    g2.players.A.legend!.count = 9;
    const b2 = g2.players.B.life;
    applyAction(g2, { t: 'advance' });
    expect(g2.players.B.life).toBe(b2); // floor(9/10)=0 → 不造成
  });
});

describe('L11 永恒女王（持续）', () => {
  const queenB = () =>
    setupGame({ seed: 1, firstPlayer: 'A', legendB: 'L11', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] });

  const lethalAttack = (g: GameState): void => {
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.A.areas.attack = [die('a1', 1, 'attack')];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    g.pendingAttack!.value = 20; // 致死
    applyAction(g, { t: 'block' });
  };

  it('受到致命「伤害」→ 取消该伤害、取消一切、立即开始你的新回合（整局 1 次）', () => {
    const g = queenB();
    g.players.B.life = 3;
    lethalAttack(g);
    expect(g.players.B.life).toBe(3); // 伤害被取消
    expect(g.phase).not.toBe('gameOver');
    expect(g.activePlayer).toBe('B'); // 立即开始 B 的新回合
    expect(g.legendOnceUsed).toContain('B:aiwa.yonghengnvwang');
  });

  it('触发时发 skillFired（永恒女王）', () => {
    const g = queenB();
    g.players.B.life = 3;
    lethalAttack(g);
    expect(fxTake().some((e) => e.kind === 'skillFired' && e.skillKey === 'aiwa.yonghengnvwang')).toBe(true);
  });

  it('整局仅 1 次：已用过后不再拦截（直接判负）', () => {
    const g = queenB();
    g.players.B.life = 3;
    g.legendOnceUsed.push('B:aiwa.yonghengnvwang');
    lethalAttack(g);
    expect(g.phase).toBe('gameOver');
    expect(g.winner).toBe('A');
  });

  it('受到致命「真实伤害」→ 同样触发（由「邪灵序曲」回合末真伤驱动）', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L11', legendB: 'L11', heroA: ['031', '032', '033'], heroB: ['004', '005', '006'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.A.areas = { attack: [], defense: [], meditation: [] };
    g.players.A.legend!.count = 90; // floor 9
    g.players.B.life = 5;
    applyAction(g, { t: 'advance' });
    expect(g.players.B.life).toBe(5); // 真伤被取消
    expect(g.activePlayer).toBe('B');
    expect(g.legendOnceUsed).toContain('B:aiwa.yonghengnvwang');
  });

  it('不触发：033 抹零（非伤害的生命下降）', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendB: 'L11', heroA: ['031', '032', '033'], heroB: ['004', '005', '006'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.B.life = 5;
    runSkill(g, 'A', '033', 'diaoling.charge'); // B 5 → 0
    expect(g.players.B.life).toBe(0);
    expect(g.legendOnceUsed).not.toContain('B:aiwa.yonghengnvwang');
  });

  it('不触发：L09 遍野残杀的"立即死亡"', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L11', heroA: ['031', '032', '033'], heroB: ['004', '005', '006'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.A.artifacts[0].allSidesActiveThisTurn = true;
    endTurn(g);
    expect(g.phase).toBe('gameOver');
    expect(g.legendOnceUsed).not.toContain('A:aiwa.yonghengnvwang');
  });

  it('不触发：尘落达 10（非伤害，直接结束）', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L11', heroA: ['031', '032', '033'], heroB: ['004', '005', '006'] });
    g.dustfall = 9;
    incrementDustfall(g);
    expect(g.phase).toBe('gameOver');
    expect(g.legendOnceUsed).toHaveLength(0);
  });
});

describe('L12 见我身者菩提心（持续）', () => {
  const l12Game = () =>
    setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L12', heroA: ['034', '035', '036'], heroB: ['004', '005', '006'] });

  it('回血时额外回复 X（X＝对方空骰区数）；X=0 则不加', () => {
    const g = l12Game();
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.A.life = g.players.A.lifeMax - 20;
    g.players.B.areas = { attack: [], defense: [], meditation: [] }; // 对方 3 区全空 → X=3
    expect(heal(g, 'A', 2)).toBe(5); // 2 + 3

    const g2 = l12Game();
    g2.phase = 'main';
    g2.activePlayer = 'A';
    g2.players.A.life = g2.players.A.lifeMax - 20;
    g2.players.B.areas = {
      attack: [die('b1', 1, 'attack')],
      defense: [die('b2', 2, 'defense')],
      meditation: [die('b3', 3, 'meditation')],
    }; // 无空区 → X=0
    expect(heal(g2, 'A', 2)).toBe(2);
  });

  it('满血（基础回复实际为 0）不额外回复', () => {
    const g = l12Game();
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.A.life = g.players.A.lifeMax;
    g.players.B.areas = { attack: [], defense: [], meditation: [] };
    expect(heal(g, 'A', 2)).toBe(0);
  });
});

describe('L12 闻我名者断恶行（触发）', () => {
  const l12B = () =>
    setupGame({ seed: 1, firstPlayer: 'A', legendB: 'L12', heroA: ['001', '002', '003'], heroB: ['034', '035', '036'] });

  it('受到攻击伤害后 → 弹询问（决策人＝持有者）；可弃置对方 1 个攻击骰', () => {
    const g = l12B();
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.B.life = 40;
    g.players.A.areas.attack = [die('a1', 1, 'attack'), die('ak', 2, 'attack')];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    g.pendingAttack!.value = 12; // 非致死
    applyAction(g, { t: 'block' });
    expect(g.pending?.kind).toBe('duanexing');
    expect(g.pending && g.pending.kind === 'duanexing' ? g.pending.player : null).toBe('B');
    const dieIds = getLegalActions(g)
      .filter((x): x is Extract<Action, { t: 'duanexing' }> => x.t === 'duanexing')
      .map((x) => x.dieId ?? null);
    expect(dieIds).toEqual([null, 'ak']); // 不发动 + 对方（A）攻击骰区每颗
    applyAction(g, { t: 'duanexing', accept: true, dieId: 'ak' });
    expect(g.players.A.areas.attack).toHaveLength(0);
    expect(g.pending).toBeNull();
  });

  it('受到真实伤害（含自伤真伤）同样触发', () => {
    const g = l12B();
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.A.areas.attack = [die('ak', 2, 'attack')];
    dealTrueDamage(g, 'B', 1, 'A');
    pumpPending(g);
    expect(g.pending?.kind).toBe('duanexing');

    const g2 = l12B();
    g2.phase = 'main';
    g2.activePlayer = 'A';
    g2.players.A.areas.attack = [die('ak', 2, 'attack')];
    dealTrueDamage(g2, 'B', 1, 'B'); // 自伤真伤
    pumpPending(g2);
    expect(g2.pending?.kind).toBe('duanexing');
  });

  it('每回合最多 1 次：本回合第二次受伤不再弹（不发动也照记一次）', () => {
    const g = l12B();
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.A.areas.attack = [die('ak', 2, 'attack')];
    dealTrueDamage(g, 'B', 1, 'A');
    pumpPending(g);
    expect(g.pending?.kind).toBe('duanexing');
    applyAction(g, { t: 'duanexing', accept: false });
    dealTrueDamage(g, 'B', 1, 'A');
    pumpPending(g);
    expect(g.pending).toBeNull();
  });

  it('对方没有攻击骰 → 不弹（不可完成）', () => {
    const g = l12B();
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.A.areas = { attack: [], defense: [], meditation: [] };
    dealTrueDamage(g, 'B', 1, 'A');
    pumpPending(g);
    expect(g.pending).toBeNull();
  });

  it('弃置的只能是对方**区域内**的攻击骰（神上存放骰不算）', () => {
    const g = setupGame({
      seed: 1,
      firstPlayer: 'A',
      legendB: 'L12',
      heroA: ['034', '035', '036'],
      heroB: ['001', '002', '003'],
    });
    g.phase = 'main';
    g.activePlayer = 'A';
    g.players.A.areas.attack = [die('ak', 2, 'attack')];
    const a034 = g.players.A.artifacts.find((x) => x.id === '034')!;
    a034.heldDice = [{ id: 'A-034-j3', value: 3 }]; // 存放骰（不属任何区域）
    dealTrueDamage(g, 'B', 1, 'A');
    pumpPending(g);
    const dieIds = getLegalActions(g)
      .filter((x): x is Extract<Action, { t: 'duanexing' }> => x.t === 'duanexing')
      .map((x) => x.dieId ?? null);
    expect(dieIds).toEqual([null, 'ak']); // 不含 'A-034-j3'
  });
});

describe('L12 知我心者立地成佛（必杀·尘落前置 3）', () => {
  const l12Game = () =>
    setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L12', heroA: ['034', '035', '036'], heroB: ['004', '005', '006'] });
  const ult: Action = { t: 'skill', artifactId: 'L12', side: 'only', params: { legendKey: 'miyun.lidichengfo' } };

  it('尘落前置 3：不足时不出现在合法动作里', () => {
    const g = l12Game();
    g.phase = 'main';
    g.activePlayer = 'A';
    g.dustfall = 2;
    const has = (): boolean =>
      getLegalActions(g).some((x) => x.t === 'skill' && x.params?.legendKey === 'miyun.lidichengfo');
    expect(has()).toBe(false);
    g.dustfall = 3;
    expect(has()).toBe(true);
  });

  it('N＝双方"有且只有 1 种点数"的区域数 → 6×N 一次真伤 → 弃置这些区域的骰（空区/多点数区不计）', () => {
    const g = l12Game();
    g.phase = 'main';
    g.activePlayer = 'A';
    g.dustfall = 3;
    g.players.B.life = 200;
    g.players.B.lifeMax = 200;
    g.players.A.areas = {
      attack: [die('a1', 3, 'attack'), die('a2', 3, 'attack')], // 1 种 → 计
      defense: [],
      meditation: [die('a3', 2, 'meditation')], // 1 种 → 计
    };
    g.players.B.areas = {
      attack: [die('b1', 1, 'attack'), die('b2', 2, 'attack')], // 2 种 → 不计
      defense: [die('b3', 6, 'defense')], // 1 种 → 计
      meditation: [], // 空 → 不计
    };
    const bLife = g.players.B.life;
    applyAction(g, ult);
    expect(g.players.B.life).toBe(bLife - 18); // N=3 → 6×3
    expect(g.players.A.areas.attack).toHaveLength(0);
    expect(g.players.A.areas.meditation).toHaveLength(0);
    expect(g.players.B.areas.defense).toHaveLength(0);
    expect(g.players.B.areas.attack).toHaveLength(2); // 多点数区保留
  });

  it('N=0 → 不造成伤害、不弃置', () => {
    const g = l12Game();
    g.phase = 'main';
    g.activePlayer = 'A';
    g.dustfall = 3;
    g.players.A.areas = { attack: [die('a1', 1, 'attack'), die('a2', 2, 'attack')], defense: [], meditation: [] };
    g.players.B.areas = { attack: [], defense: [die('b1', 3, 'defense'), die('b2', 4, 'defense')], meditation: [] };
    const bLife = g.players.B.life;
    applyAction(g, ult);
    expect(g.players.B.life).toBe(bLife);
    expect(g.players.B.areas.defense).toHaveLength(2);
  });

  it('打死对方 → 不再处理弃置', () => {
    const g = l12Game();
    g.phase = 'main';
    g.activePlayer = 'A';
    g.dustfall = 3;
    g.players.B.life = 5;
    g.players.A.areas = { attack: [die('a1', 3, 'attack')], defense: [], meditation: [] };
    g.players.B.areas = { attack: [], defense: [die('b1', 6, 'defense')], meditation: [] };
    applyAction(g, ult); // N=2 → 12 真伤 → 打死
    expect(g.phase).toBe('gameOver');
    expect(g.players.B.areas.defense).toHaveLength(1); // 未弃置
    expect(g.players.A.areas.attack).toHaveLength(1);
  });
});

describe('L11 永恒女王 打断行为（2026-09-29 裁定）', () => {
  it('打断必杀后，该必杀仍记为"已用"（修复：L12 立地成佛 能再发动一次）', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L12', legendB: 'L11', heroA: ['034', '035', '036'], heroB: ['031', '032', '033'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    g.dustfall = 3;
    g.players.B.life = 5;
    g.players.A.areas = { attack: [die('a1', 3, 'attack')], defense: [], meditation: [] };
    g.players.B.areas = { attack: [], defense: [], meditation: [] };
    applyAction(g, { t: 'skill', artifactId: 'L12', side: 'only', params: { legendKey: 'miyun.lidichengfo' } });
    expect(g.players.B.life).toBe(5); // 伤害被取消
    expect(g.legendOnceUsed).toContain('B:aiwa.yonghengnvwang');
    expect(g.ultimatesUsed).toContain('A:miyun.lidichengfo'); // 关键：仍记为"已用"
  });

  it('打断后：已生效状态保留（全开）；"只持续一回合"的状态照常到期；首回合标记修正', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L09', legendB: 'L11', heroA: ['028', '029', '030'], heroB: ['031', '032', '033'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    const A = g.players.A;
    A.artifacts.forEach((a) => {
      a.allSidesActiveThisTurn = true; // 模拟遍野残杀"全开"
    });
    A.buffs.push({ attr: 'attackDamage', add: 5, duration: 'thisTurn', source: '测试-本回合' });
    A.buffs.push({ attr: 'attackDamage', add: 2, duration: 'permanent', source: '测试-永久' });
    A.attackHalvedNextTurn = true;
    g.players.B.life = 5;
    A.areas.attack = [die('a1', 1, 'attack')];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    g.pendingAttack!.value = 20;
    applyAction(g, { t: 'block' });
    expect(g.players.B.life).toBe(5); // 伤害被取消
    expect(g.legendOnceUsed).toContain('B:aiwa.yonghengnvwang');
    expect(g.activePlayer).toBe('B'); // 守护者开新回合
    // 已生效状态保留：全开
    expect(A.artifacts.every((a) => a.allSidesActiveThisTurn === true)).toBe(true);
    // 只持续一回合的状态照常到期
    expect(A.buffs.some((b) => b.duration === 'thisTurn')).toBe(false);
    expect(A.buffs.some((b) => b.duration === 'permanent')).toBe(true);
    expect(A.attackHalvedNextTurn).toBe(false);
    // 首回合标记修正
    expect(g.firstRound.A).toBe(false);
  });

  it('031 血祭：攻击已完整结算后才自伤；自伤致死触发自身永恒女王，计数照常 +1', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L11', heroA: ['031', '032', '033'], heroB: ['004', '005', '006'] });
    g.phase = 'main';
    g.activePlayer = 'A';
    const A = g.players.A;
    const a031 = A.artifacts.find((a) => a.id === '031')!;
    a031.activeMarkerSide = 'left';
    a031.armedSide = 'left';
    a031.count = 5; // 计数上限 7；本次攻击后 → 6
    A.life = 5;
    g.players.B.life = 100;
    g.players.B.lifeMax = 100;
    A.areas.attack = [die('a1', 1, 'attack')];
    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['a1'] }] });
    g.pendingAttack!.value = 1;
    applyAction(g, { t: 'block' });
    expect(g.players.B.life).toBe(99); // 攻击已造成伤害
    expect(a031.count).toBe(6); // 计数照常 +1
    expect(A.life).toBe(5); // 血祭自伤被永恒女王取消
    expect(g.legendOnceUsed).toContain('A:aiwa.yonghengnvwang');
    expect(g.activePlayer).toBe('A'); // 立即开自己的新回合
  });
});

describe('A07 历王之血之印：本回合双方「持续式」失效（含传奇面板）', () => {
  it('必杀发动后 → 双方神器与传奇面板的 continuousLostThisTurn 置真；下回合开始清除', () => {
    const g = setupGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['A07', '002', '003'],
      heroB: ['004', '005', '006'],
      legendA: 'L02',
      legendB: 'L12',
    });
    g.phase = 'main';
    g.activePlayer = 'A';
    for (const who of ['A', 'B'] as PlayerId[]) {
      g.players[who].areas.attack = [];
      g.players[who].areas.defense = [];
      g.players[who].areas.meditation = [];
    }
    const a07 = g.players.A.artifacts.find((a) => a.id === 'A07')!;
    a07.chargeLayer = a07.chargeReq ?? 0;
    a07.activeMarkerSide = 'left';
    applyAction(g, { t: 'skill', artifactId: 'A07', side: 'only', params: {} });
    expect(g.players.A.legend!.continuousLostThisTurn).toBe(true);
    expect(g.players.B.legend!.continuousLostThisTurn).toBe(true);
    expect(g.players.A.artifacts.every((a) => a.continuousLostThisTurn)).toBe(true);
    expect(g.players.B.artifacts.every((a) => a.continuousLostThisTurn)).toBe(true);
    // 进入下一回合 → 清除（神器与传奇都要清）
    beginTurn(g);
    expect(g.players.A.legend!.continuousLostThisTurn).toBe(false);
    expect(g.players.B.legend!.continuousLostThisTurn).toBe(false);
    expect(g.players.A.artifacts.some((a) => a.continuousLostThisTurn)).toBe(false);
  });
});
