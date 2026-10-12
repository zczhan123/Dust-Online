import { describe, it, expect } from 'vitest';
import {
  createChallengeGame,
  applyChallengeSkill,
  resolveLegendDeferred,
  applyAction,
  skipInitialReroll,
} from '../src/core/engine/game';
import { checkLifeEnd } from '../src/core/engine/combat';
import { CHALLENGES } from '../src/core/content/challenges';
import type { Die, DiceKind, GameState } from '../src/core/model/types';

const die = (id: string, value: number, kind: DiceKind = 'meditation'): Die => ({ id, value, kind });
const Z06 = CHALLENGES.find((c) => c.id === 'Z06')!;
const SK = (id: string) => Z06.skills!.find((s) => s.id === id)!;
const make = (mode: 'manual' | 'favor' | 'against' = 'manual') =>
  createChallengeGame({ seed: 1, cardId: 'Z06', challenger: ['001', '002', '003'], settleMode: mode });
const setA = (g: GameState, areas: { attack?: Die[]; defense?: Die[]; meditation?: Die[] }): void => {
  g.players.A.areas.attack = areas.attack ?? [];
  g.players.A.areas.defense = areas.defense ?? [];
  g.players.A.areas.meditation = areas.meditation ?? [];
};
const vals = (ds: Die[]) => ds.map((d) => d.value);

describe('挑战模式 · Z06 漆黑死神 · 数据', () => {
  it('生命 45 / 门槛 3 / 投 6 / 防御骰上限 4 / 黑白指示物 / 7 条（含 unordered 死即新生）', () => {
    expect(Z06.life).toBe(45);
    expect(Z06.defenseMin).toBe(3);
    expect(Z06.rollDice).toBe(6);
    expect(Z06.defenseCap).toBe(4);
    expect(Z06.token).toBe(true);
    expect(Z06.skills).toHaveLength(7);
    expect(SK('z06-2').color).toBe('black');
    expect(SK('z06-3').color).toBe('black');
    expect(SK('z06-4').color).toBe('white');
    expect(SK('z06-5').color).toBe('white');
    expect(SK('z06-2').slots).toEqual([{ kind: 'same', count: 3 }]);
    expect(SK('z06-3').slots).toEqual([{ kind: 'same', count: 2 }]);
    expect(SK('z06-5').slots).toEqual([{ kind: 'same', count: 2 }]);
    expect(SK('z06-x').unordered).toBe(true);
  });

  it('黑白指示物：建局＝黑面朝上', () => {
    const g = make();
    expect(g.challenge!.token).toBe('black');
  });
});

describe('挑战模式 · Z06 效果', () => {
  it('虚无形态：自身受 10 真伤 + 5 次 5 点攻击（带"第 j / 5 次"）', () => {
    const g = make();
    setA(g, {});
    g.players.B.areas.attack = [];
    const life0 = g.players.B.life;
    applyChallengeSkill(g, Z06, SK('z06-2'), []);
    expect(g.players.B.life).toBe(life0 - 10);
    expect(g.pendingAttack).toMatchObject({ attacker: 'B', baseValue: 5 });
    expect(g.pendingAttack?.legendGroup).toEqual({ index: 1, total: 1, sub: 1, subTotal: 5 });
    expect(g.virtualQueue).toHaveLength(4); // 5 段：1 发出 + 4 待
  });

  it('勾魂镰：本回合攻击伤害 +2；驱骰→防御区、其余→攻击区并全部攻击', () => {
    const g = make();
    setA(g, {});
    g.players.B.areas.defense = [];
    g.players.B.areas.attack = [];
    g.challenge!.driven = [die('r1', 4), die('r2', 6)];
    applyChallengeSkill(g, Z06, SK('z06-3'), [die('k1', 5), die('k2', 5)]);
    expect(g.players.B.buffs.some((b) => b.source === '勾魂镰·黑')).toBe(true); // 本回合 +2
    resolveLegendDeferred(g, Z06); // ① 本技能驱骰 → 防御区
    expect(vals(g.players.B.areas.defense)).toEqual([5, 5]);
    resolveLegendDeferred(g, Z06); // ②a 其余驱动骰 → 攻击区
    expect(vals(g.players.B.areas.attack)).toEqual([4, 6]);
    expect(vals(g.challenge!.driven)).toEqual([]);
    g.challenge!.decisions = { 'z06-3': ['desc'] }; // 顺序（跳过面板）
    resolveLegendDeferred(g, Z06); // ②b/②c 按顺序逐个攻击
    expect(g.pendingAttack).toMatchObject({ attacker: 'B' });
    expect(g.pendingAttack?.baseValue).toBe(6); // desc → 先打大的（+2 加成体现在 value）
    expect(g.virtualQueue).toHaveLength(1); // 2 颗：1 发出 + 1 待
  });

  it('勾魂镰·攻击顺序代决：攻击区 >1 颗 → 弹面板（asc/desc）', () => {
    const g = make();
    setA(g, {});
    g.players.B.areas.defense = [];
    g.players.B.areas.attack = [];
    g.challenge!.driven = [die('r1', 4), die('r2', 6)];
    applyChallengeSkill(g, Z06, SK('z06-3'), [die('k1', 5), die('k2', 5)]);
    resolveLegendDeferred(g, Z06); // ① 防御区
    resolveLegendDeferred(g, Z06); // ②a 其余 → 攻击区
    resolveLegendDeferred(g, Z06); // ②b 顺序面板
    expect(g.pending?.kind).toBe('challengePick');
    if (g.pending?.kind !== 'challengePick') throw new Error('expect challengePick');
    expect(g.pending.options.map((o) => o.id)).toEqual(['asc', 'desc']);
  });

  it('圆舞：驱骰→防御区、其余→攻击区并全部攻击（无 +2）', () => {
    const g = make();
    setA(g, {});
    g.players.B.areas.defense = [];
    g.players.B.areas.attack = [];
    g.challenge!.driven = [die('r1', 2)];
    applyChallengeSkill(g, Z06, SK('z06-5'), [die('k1', 3), die('k2', 3)]);
    expect(g.players.B.buffs.some((b) => b.source === '勾魂镰')).toBe(false);
    resolveLegendDeferred(g, Z06);
    expect(vals(g.players.B.areas.defense)).toEqual([3, 3]);
    resolveLegendDeferred(g, Z06); // ②a 其余 → 攻击区
    expect(vals(g.players.B.areas.attack)).toEqual([2]);
    resolveLegendDeferred(g, Z06); // ②b/②c（仅 1 颗）→ 直接攻击
    expect(g.pendingAttack).toMatchObject({ attacker: 'B' });
  });

  it('冥界行走：本回合其攻击造成伤害 → 回复该点数一半（向上取整）', () => {
    const g = make();
    setA(g, {});
    g.players.B.life = 20; // 先掉血，否则回血被生命上限截断
    applyChallengeSkill(g, Z06, SK('z06-4'), []);
    expect(g.challenge!.mingjieHeal).toBe(true);
    g.pendingAttack = { attacker: 'B', value: 7, baseValue: 7, unblockable: false, physical: false };
    applyAction(g, { t: 'block' }); // 挑战者不抵挡 → 造成 7 伤害 → 回复 ceil(7/2)=4
    expect(g.players.B.life).toBe(24);
  });

  it('冥界行走：**按"攻击点数"取值**（口径用例：合成 pa，Z06 内实际不可达）', () => {
    // 卡面＝"回复该**攻击点数**一半" → 取 `baseValue`（**不是**伤害 `value`）。
    // 注：Z06 的**黑/白两面技能不共存**（勾魂镰黑面 / 冥界行走白面）→ 真实对局里 value ≡ baseValue；
    //     本用例是**口径**用例（合成一个 value≠baseValue 的 pa，锁"取哪个字段"），不是复现某局。
    const g = make();
    setA(g, {});
    g.players.B.life = 20;
    applyChallengeSkill(g, Z06, SK('z06-4'), []);
    g.pendingAttack = { attacker: 'B', value: 7, baseValue: 5, unblockable: false, physical: false };
    applyAction(g, { t: 'block' });
    expect(g.players.B.life).toBe(23); // ceil(5/2)=3（若误取伤害 value 会得 ceil(7/2)=4）
  });

  it('勾魂镰·选组代决：驱动骰有多组同点（2 点组 + 5 点组）→ 弹面板自选', () => {
    const g = make();
    skipInitialReroll(g);
    g.phase = 'main';
    g.activePlayer = 'B';
    g.challenge!.token = 'black';
    g.challenge!.turn = 1;
    g.challenge!.resumeAt = 3; // z06-3 勾魂镰
    g.challenge!.driven = [die('a1', 2), die('a2', 2), die('b1', 5), die('b2', 5)];
    applyAction(g, { t: 'challengeStep' });
    expect(g.pending?.kind).toBe('challengePick');
    if (g.pending?.kind !== 'challengePick') throw new Error('expect challengePick');
    expect(g.pending.options.map((o) => o.id).sort()).toEqual(['2', '5']);
  });

  it('勾魂镰·选组代决自动（有利＝点数大 / 不利＝点数小）', () => {
    const drive = (mode: 'favor' | 'against'): GameState => {
      const g = make(mode);
      skipInitialReroll(g);
      g.phase = 'main';
      g.activePlayer = 'B';
      g.challenge!.token = 'black';
      g.challenge!.turn = 1;
      g.challenge!.resumeAt = 3;
      g.challenge!.driven = [die('a1', 2), die('a2', 2), die('b1', 5), die('b2', 5)];
      applyAction(g, { t: 'challengeStep' }); // 代决 + 发动（挂 deferred）
      for (let k = 0; k < 6 && g.challenge!.deferred; k++) applyAction(g, { t: 'challengeStep' });
      return g;
    };
    const gF = drive('favor'); // 有利＝点数大 → 本技能骰＝5 点组（进防御区）
    expect(vals(gF.players.B.areas.defense)).toEqual([5, 5]);
    expect(vals(gF.players.B.areas.attack)).toEqual([2, 2]);
    const gA = drive('against'); // 不利＝点数小 → 本技能骰＝2 点组
    expect(vals(gA.players.B.areas.defense)).toEqual([2, 2]);
    expect(vals(gA.players.B.areas.attack)).toEqual([5, 5]);
  });

  it('勾魂镰·防御区已满 4：本技能骰放不下 → **弃置**（不挤旧），其余仍进攻击区', () => {
    const g = make();
    setA(g, {});
    g.players.B.areas.defense = [die('bd0', 1, 'defense'), die('bd1', 1, 'defense'), die('bd2', 1, 'defense'), die('bd3', 1, 'defense')];
    g.players.B.areas.attack = [];
    g.challenge!.driven = [die('r1', 4)];
    applyChallengeSkill(g, Z06, SK('z06-3'), [die('k1', 5), die('k2', 5)]);
    resolveLegendDeferred(g, Z06); // ① 防御区满 → room 0 → 本技能骰弃置
    expect(g.players.B.areas.defense).toHaveLength(4); // 不变、不挤旧
    resolveLegendDeferred(g, Z06); // ② 其余驱动骰 → 攻击区
    expect(vals(g.players.B.areas.attack)).toEqual([4]);
  });

  it('死即新生：生命归 0 → 复活（生命 13 + 1..6 攻击骰各 1 个），整局 1 次', () => {
    const g = make();
    g.players.B.areas.attack = [];
    g.players.B.life = 0;
    checkLifeEnd(g);
    expect(g.phase).not.toBe('gameOver');
    expect(g.players.B.life).toBe(13);
    expect(vals(g.players.B.areas.attack).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(g.challenge!.deathUsed).toBe(true);
    // 再死一次 → 这次真的判负
    g.players.B.life = 0;
    checkLifeEnd(g);
    expect(g.phase).toBe('gameOver');
    expect(g.winner).toBe('A');
  });

  it('虚无形态 × 死即新生：自伤 10 点致死 → **复活后继续** 5 次 5 点攻击（作者裁定 2026-10-11）', () => {
    const g = make();
    setA(g, {});
    g.players.B.areas.attack = [];
    g.players.B.life = 8; // 受 10 真伤必死
    expect(g.challenge!.deathUsed).toBeFalsy();
    applyChallengeSkill(g, Z06, SK('z06-2'), []);
    expect(g.players.B.life).toBe(13); // 死即新生：生命重设 13
    expect(g.challenge!.deathUsed).toBe(true);
    expect(g.phase).not.toBe('gameOver');
    expect(vals(g.players.B.areas.attack).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]); // 复活给的骰
    // ★ 5 次 5 点攻击照常发起（不被"死亡"打断）
    expect(g.pendingAttack).toMatchObject({ attacker: 'B', baseValue: 5 });
    expect(g.pendingAttack?.legendGroup).toEqual({ index: 1, total: 1, sub: 1, subTotal: 5 });
    expect(g.virtualQueue).toHaveLength(4);
    let n = 0;
    let guard = 0;
    while ((g.pendingAttack || (g.virtualQueue ?? []).length > 0) && guard++ < 30) {
      if (g.pendingAttack) {
        applyAction(g, { t: 'block' });
        n++;
      }
    }
    expect(n).toBe(5); // 5 段全部结算
  });
});
