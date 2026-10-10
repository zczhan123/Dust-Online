import { describe, it, expect } from 'vitest';
import {
  createChallengeGame,
  applyChallengeSkill,
  resolveLegendDeferred,
  applyAction,
  skipInitialReroll,
} from '../src/core/engine/game';
import { CHALLENGES } from '../src/core/content/challenges';
import type { Die, DiceKind, GameState } from '../src/core/model/types';

const die = (id: string, value: number, kind: DiceKind = 'meditation'): Die => ({ id, value, kind });
const Z03 = CHALLENGES.find((c) => c.id === 'Z03')!;
const SK = (id: string) => Z03.skills!.find((s) => s.id === id)!;
const make = () => createChallengeGame({ seed: 1, cardId: 'Z03', challenger: ['001', '002', '003'] });
/** 直接铺好挑战者(A)的能力骰区（建局时它自带初始骰，必须覆盖）。 */
const setA = (g: GameState, areas: { attack?: Die[]; defense?: Die[]; meditation?: Die[] }): void => {
  g.players.A.areas.attack = areas.attack ?? [];
  g.players.A.areas.defense = areas.defense ?? [];
  g.players.A.areas.meditation = areas.meditation ?? [];
};
const vals = (ds: Die[]) => ds.map((d) => d.value);

describe('挑战模式 · Z03 孤塔之王 · 数据/元数据', () => {
  it('投 6 驱动骰、生命 70、门槛 2、无防御骰上限、6 条技能', () => {
    expect(Z03.rollDice).toBe(6);
    expect(Z03.life).toBe(70);
    expect(Z03.defenseMin).toBe(2);
    expect(Z03.defenseCap).toBeUndefined();
    expect(Z03.skills).toHaveLength(6);
    expect(Z03.skills![2].slots).toEqual([{ kind: 'same', count: 3 }]);
    expect(Z03.skills![3].slots).toEqual([
      { kind: 'pips', count: 1, faces: [1, 2] },
      { kind: 'pips', count: 1, faces: [3, 4] },
      { kind: 'pips', count: 1, faces: [5, 6] },
    ]);
  });
});

describe('挑战模式 · Z03 效果', () => {
  it('统御战场：挑战者**所有攻击骰**点数变更为 1（原地改点、不动区域）', () => {
    const g = make();
    setA(g, { attack: [die('a1', 3, 'attack'), die('a2', 6, 'attack')] });
    applyChallengeSkill(g, Z03, SK('z03-1'), []);
    expect(vals(g.players.A.areas.attack)).toEqual([1, 1]);
    expect(g.players.A.areas.attack.map((d) => d.id)).toEqual(['a1', 'a2']);
  });

  it('震荡斩击：弃"最多区域"里的 4 颗；弃满 4 → 不攻击', () => {
    const g = make();
    setA(g, { attack: [1, 2, 3, 4, 5].map((v, i) => die(`a${i}`, v, 'attack')) }); // 最多＝攻击区 5 颗
    applyChallengeSkill(g, Z03, SK('z03-2'), [die('k1', 1), die('k2', 2), die('k3', 3)]);
    expect(g.players.A.areas.attack).toHaveLength(1);
    expect(g.pendingAttack).toBeNull();
    expect(g.challenge!.firedThisTurn).toContain('z03-2');
  });

  it('震荡斩击：区域不足 4 颗 → 弃光 + 1 次 5 点攻击', () => {
    const g = make();
    setA(g, { defense: [die('d1', 2, 'defense'), die('d2', 4, 'defense')] }); // 最多＝防御区 2 颗
    applyChallengeSkill(g, Z03, SK('z03-2'), [die('k1', 1), die('k2', 2), die('k3', 3)]);
    expect(g.players.A.areas.defense).toHaveLength(0);
    expect(g.pendingAttack).toMatchObject({ attacker: 'B', baseValue: 5 });
  });

  it('战争横扫：每种类型各弃 1 颗；缺 1 种 → 1 次 5 点攻击', () => {
    const g = make();
    setA(g, { attack: [die('a1', 3, 'attack')], meditation: [die('m1', 5, 'meditation')] }); // 缺防御
    applyChallengeSkill(g, Z03, SK('z03-3'), [die('k1', 1), die('k2', 3), die('k3', 5)]);
    expect(g.players.A.areas.attack).toHaveLength(0);
    expect(g.players.A.areas.meditation).toHaveLength(0);
    expect(g.pendingAttack).toMatchObject({ attacker: 'B', baseValue: 5 });
    expect(g.virtualQueue ?? []).toHaveLength(0); // 只 1 段
    expect(g.challenge!.firedThisTurn).toContain('z03-3');
  });

  it('战争横扫：缺 2 种 → 2 段 5 点攻击（多段队列）', () => {
    const g = make();
    setA(g, { attack: [die('a1', 3, 'attack')] }); // 缺防御 + 冥想
    applyChallengeSkill(g, Z03, SK('z03-3'), [die('k1', 1), die('k2', 3), die('k3', 5)]);
    expect(g.pendingAttack).toMatchObject({ baseValue: 5 });
    expect(g.virtualQueue ?? []).toHaveLength(1); // 1 发出 + 1 待
  });

  it('战车：① 5 点攻击 + ② 用全部攻击骰逐个攻击 + ③ 结算后补防御至 4（每颗 2 真伤）', () => {
    const g = make();
    setA(g, {});
    g.players.B.areas.attack = [die('b1', 2, 'attack'), die('b2', 4, 'attack')];
    g.players.B.areas.defense = [];
    applyChallengeSkill(g, Z03, SK('z03-4'), []);
    expect(g.pendingAttack).toMatchObject({ attacker: 'B', baseValue: 5 }); // ①
    expect(g.challenge!.deferred).toMatchObject({ skillId: 'z03-4' }); // ③ 待攻击结算后
    let guard = 0;
    while ((g.pendingAttack || (g.virtualQueue ?? []).length) && guard++ < 20) {
      if (g.pendingAttack) applyAction(g, { t: 'block' });
    }
    const life0 = g.players.B.life;
    resolveLegendDeferred(g, Z03); // ③
    expect(g.players.B.areas.defense).toHaveLength(4);
    expect(g.players.B.life).toBe(life0 - 8); // 补 4 颗 → 4×2 真伤
    expect(g.challenge!.deferred).toBeUndefined();
  });

  it('拔城：本回合未发动震荡/横扫 → 弃全部挑战者能力骰 + 2 次 5 点攻击', () => {
    const g = make();
    g.challenge!.firedThisTurn = [];
    setA(g, {
      attack: [die('a1', 3, 'attack')],
      defense: [die('d1', 2, 'defense')],
      meditation: [die('m1', 5, 'meditation')],
    });
    applyChallengeSkill(g, Z03, SK('z03-5'), []);
    expect(g.players.A.areas.attack).toHaveLength(0);
    expect(g.players.A.areas.defense).toHaveLength(0);
    expect(g.players.A.areas.meditation).toHaveLength(0);
    expect(g.pendingAttack).toMatchObject({ attacker: 'B', baseValue: 5 });
    expect(g.virtualQueue ?? []).toHaveLength(1); // 2 段：1 发出 + 1 待
  });

  it('拔城：本回合已发动过震荡斩击 → 不执行', () => {
    const g = make();
    g.challenge!.firedThisTurn = ['z03-2'];
    setA(g, { attack: [die('a1', 3, 'attack')] });
    applyChallengeSkill(g, Z03, SK('z03-5'), []);
    expect(g.players.A.areas.attack).toHaveLength(1);
    expect(g.pendingAttack).toBeNull();
  });

  it('拔城：本回合已发动过战争横扫 → 不执行', () => {
    const g = make();
    g.challenge!.firedThisTurn = ['z03-3'];
    setA(g, { attack: [die('a1', 3, 'attack')] });
    applyChallengeSkill(g, Z03, SK('z03-5'), []);
    expect(g.players.A.areas.attack).toHaveLength(1);
    expect(g.pendingAttack).toBeNull();
  });
});

describe('挑战模式 · Z03 代决（自选＝挑战者弹面板 / 有利·不利）', () => {
  /** 停在"轮到传奇、下一条＝skills[resumeAt]"。 */
  const atZ03 = (g: GameState, resumeAt: number, driven: number[]): void => {
    skipInitialReroll(g);
    g.challenge!.resumeAt = resumeAt;
    g.challenge!.driven = driven.map((v, i) => die(`drv${i}`, v));
  };

  it('震荡斩击·自选：最多区域 > 4 颗 → 弹面板让挑战者选弃哪 4 颗', () => {
    const g = make();
    atZ03(g, 2, [2, 2, 2]); // z03-2 槽＝3 同点
    setA(g, { attack: [1, 2, 3, 4, 5, 6].map((v, i) => die(`a${i}`, v, 'attack')) });
    applyAction(g, { t: 'challengeStep' });
    expect(g.pending?.kind).toBe('challengePick');
    if (g.pending?.kind !== 'challengePick') throw new Error('expect challengePick');
    // 选项为"攻击区里取 4 颗"的组合（C(6,4)=15）
    expect(g.pending.options).toHaveLength(15);
  });

  it('战争横扫·自选：某类型 > 1 颗 → 弹面板选该类型弃哪颗', () => {
    const g = make();
    atZ03(g, 3, [1, 3, 5]); // z03-3 槽＝〔1/2点〕〔3/4点〕〔5/6点〕
    setA(g, { attack: [die('a1', 1, 'attack'), die('a2', 4, 'attack')] });
    applyAction(g, { t: 'challengeStep' });
    expect(g.pending?.kind).toBe('challengePick');
    if (g.pending?.kind !== 'challengePick') throw new Error('expect challengePick');
    expect(g.pending.options.map((o) => o.label).sort()).toEqual(['攻1', '攻4']);
  });

  it('战车·自选：攻击区 > 1 颗 → 弹面板定攻击顺序', () => {
    const g = make();
    atZ03(g, 4, [6]); // z03-4 ∞ 必检（无骰条件；本步必有效果）
    setA(g, {});
    g.players.B.areas.attack = [die('b1', 2, 'attack'), die('b2', 4, 'attack')];
    applyAction(g, { t: 'challengeStep' });
    expect(g.pending?.kind).toBe('challengePick');
    if (g.pending?.kind !== 'challengePick') throw new Error('expect challengePick');
    expect(g.pending.options.map((o) => o.id)).toEqual(['asc', 'desc']);
  });

  it('震荡斩击·有利：自动弃**最小**的 4 颗（不弹面板）', () => {
    const g = createChallengeGame({ seed: 1, cardId: 'Z03', challenger: ['001', '002', '003'], settleMode: 'favor' });
    atZ03(g, 2, [2, 2, 2]);
    setA(g, { attack: [1, 2, 3, 4, 5, 6].map((v, i) => die(`a${i}`, v, 'attack')) });
    applyAction(g, { t: 'challengeStep' });
    expect(g.pending).toBeNull();
    // 弃最小 4 颗（1/2/3/4）→ 余 5/6
    expect(vals(g.players.A.areas.attack).sort((a, b) => a - b)).toEqual([5, 6]);
  });
});

