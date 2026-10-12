import { describe, it, expect } from 'vitest';
import {
  createChallengeGame,
  applyChallengeSkill,
  resolveLegendDeferred,
  applyAction,
  skipInitialReroll,
} from '../src/core/engine/game';
import { settleAttack } from '../src/core/engine/combat';
import { fxTake, type FxEvent } from '../src/core/engine/fx';
import { CHALLENGES } from '../src/core/content/challenges';
import type { Die, DiceKind, GameState } from '../src/core/model/types';

const die = (id: string, value: number, kind: DiceKind = 'meditation'): Die => ({ id, value, kind });
const Z07 = CHALLENGES.find((c) => c.id === 'Z07')!;
const SK = (id: string) => Z07.skills!.find((s) => s.id === id)!;
const make = (mode: 'manual' | 'favor' | 'against' = 'manual') =>
  createChallengeGame({ seed: 1, cardId: 'Z07', challenger: ['001', '002', '003'], settleMode: mode });
const setA = (g: GameState, areas: { attack?: Die[]; defense?: Die[]; meditation?: Die[] }): void => {
  g.players.A.areas.attack = areas.attack ?? [];
  g.players.A.areas.defense = areas.defense ?? [];
  g.players.A.areas.meditation = areas.meditation ?? [];
};
const vals = (ds: Die[]) => ds.map((d) => d.value);

describe('挑战模式 · Z07 荒野行者 · 数据', () => {
  it('生命 50 / 门槛 3 / 投 4 / 防御骰上限 3 / 计数不封顶(∞) / 7 条', () => {
    expect(Z07.life).toBe(50);
    expect(Z07.defenseMin).toBe(3);
    expect(Z07.rollDice).toBe(4);
    expect(Z07.defenseCap).toBe(3);
    expect(Z07.countCap).toBe(Infinity); // 后端真无限 → 界面显示 ∞
    expect(Z07.skills).toHaveLength(7);
    expect(SK('z07-2').slots).toEqual([{ kind: 'straight', count: 3 }]);
    expect(SK('z07-4').slots).toEqual([{ kind: 'same', count: 2 }]);
    expect(SK('z07-x').unordered).toBe(true);
  });
});

describe('挑战模式 · Z07 效果', () => {
  it('燎原之火：计数 +1 → 回复 =计数 生命 → 追加投掷 =计数 驱动骰（战报**带点数**）', () => {
    const g = make();
    setA(g, {});
    g.players.B.life = 30;
    g.challenge!.driven = [];
    applyChallengeSkill(g, Z07, SK('z07-1'), []);
    expect(g.challenge!.count).toBe(1);
    expect(g.players.B.life).toBe(31); // 回复 1
    expect(g.challenge!.driven).toHaveLength(1); // 追加 1

    applyChallengeSkill(g, Z07, SK('z07-1'), []);
    expect(g.challenge!.count).toBe(2);
    expect(g.players.B.life).toBe(33); // 再回 2
    expect(g.challenge!.driven).toHaveLength(3); // 再追加 2
    // 战报带点数（升序、`/` 拼接——与「回合开始」同款）
    const texts = g.log.map((l) => l.text);
    const v1 = g.challenge!.driven[0].value;
    const v23 = g.challenge!.driven.slice(1).map((d) => d.value).sort((a, b) => a - b);
    expect(texts.some((t) => t.includes(`追加投掷 1 个驱动骰（${v1}）`))).toBe(true);
    expect(texts.some((t) => t.includes(`追加投掷 2 个驱动骰（${v23.join('/')}）`))).toBe(true);
  });

  it('不屈咆哮：弃置挑战者 =计数 的防御骰', () => {
    const g = make();
    g.challenge!.count = 2;
    setA(g, { defense: [die('d1', 3, 'defense'), die('d2', 5, 'defense'), die('d3', 6, 'defense')] });
    applyChallengeSkill(g, Z07, SK('z07-2'), []);
    expect(g.players.A.areas.defense).toHaveLength(1); // 弃 2（计数 2）
  });

  it('兽魂：奇数 ≥ 偶数 → 2 次 3 点攻击；偶数 > 奇数 → 本回合 +2', () => {
    const g1 = make();
    setA(g1, {});
    g1.challenge!.driven = [die('a', 1), die('b', 3)]; // 奇 2 / 偶 0
    applyChallengeSkill(g1, Z07, SK('z07-3'), []);
    expect(g1.pendingAttack).toMatchObject({ attacker: 'B', baseValue: 3 });
    expect(g1.pendingAttack?.legendGroup).toEqual({ index: 1, total: 1, sub: 1, subTotal: 2 }); // （第 j / 2 次）
    expect(g1.virtualQueue).toHaveLength(1); // 2 段：1 发出 + 1 待

    const g2 = make();
    setA(g2, {});
    g2.challenge!.driven = [die('a', 2), die('b', 4)]; // 偶 2 / 奇 0
    applyChallengeSkill(g2, Z07, SK('z07-3'), []);
    expect(g2.pendingAttack).toBeNull();
    expect(g2.players.B.buffs.some((b) => b.source === '兽魂')).toBe(true);
  });

  it('蛮王之牙：**逐组结算**（2 组驱骰 / 挑战者 0 防御骰）——每轮 3 次攻击；★ 下一组必须等本轮攻击结算', () => {
    const g = make();
    skipInitialReroll(g);
    g.phase = 'main';
    g.activePlayer = 'B';
    g.challenge!.turn = 1;
    g.challenge!.resumeAt = 4; // z07-4
    g.challenge!.driven = [die('a1', 4), die('a2', 4), die('b1', 5), die('b2', 5)];
    setA(g, {}); // 0 防御骰 → 每轮"补 3 次"
    g.players.B.areas.defense = [];
    const resolveAll = (): number => {
      let n = 0;
      let guard = 0;
      while ((g.pendingAttack || (g.virtualQueue ?? []).length > 0) && guard++ < 30) {
        if (g.pendingAttack) {
          applyAction(g, { t: 'block' });
          n++;
        }
      }
      return n;
    };
    applyAction(g, { t: 'challengeStep' }); // ① 发动帧：消耗**第 1 组**（a1,a2）→ 挂 deferred
    expect(g.challenge!.driven.map((d) => d.id)).toEqual(['b1', 'b2']); // 只剩第 2 组
    expect(g.pendingAttack).toBeNull();
    applyAction(g, { t: 'challengeStep' }); // ② 第 1 轮：弃 0 → 补 3 次
    expect(g.challenge!.driven.map((d) => d.id)).toEqual(['b1', 'b2']); // ★ 组间**不提前消耗**
    expect(resolveAll()).toBe(3); // 第 1 轮：3 次攻击
    applyAction(g, { t: 'challengeStep' }); // ③ 'next'：本轮攻击已结算 → **这时才**消耗第 2 组 + 弹名
    expect(g.challenge!.driven).toEqual([]);
    applyAction(g, { t: 'challengeStep' }); // ④ 第 2 轮：弃 0 → 补 3 次
    expect(resolveAll()).toBe(3); // 第 2 轮：3 次攻击
    applyAction(g, { t: 'challengeStep' }); // ⑤ 'next'：凑不出下一组 → 结束
    expect(g.challenge!.deferred).toBeUndefined();
    const texts = g.log.map((l) => l.text);
    expect(texts.filter((t) => t.includes('本轮弃挑战者 0 个防御骰，补 3 次 3 点攻击'))).toHaveLength(2);
  });

  it('蛮王之牙：驱动骰有多组同点 → **直接进"弃骰"代决**（不弹选组）；绝不报 not a defense die', () => {
    const g = make();
    skipInitialReroll(g);
    g.phase = 'main';
    g.activePlayer = 'B';
    g.challenge!.count = 1;
    g.challenge!.turn = 1;
    g.challenge!.resumeAt = 4; // z07-4 蛮王之牙
    g.challenge!.driven = [die('a1', 2), die('a2', 2), die('b1', 5), die('b2', 5)];
    setA(g, {
      defense: [die('d1', 3, 'defense'), die('d2', 4, 'defense'), die('d3', 5, 'defense'), die('d4', 6, 'defense')],
    });
    applyAction(g, { t: 'challengeStep' }); // ① 发动（挂 deferred，尚无面板）
    applyAction(g, { t: 'challengeStep' }); // ② 第 1 组"弃骰"代决（无选组）
    expect(g.pending?.kind).toBe('challengePick');
    if (g.pending?.kind !== 'challengePick') throw new Error('expect challengePick');
    expect(g.pending.prompt).toContain('弃置挑战者 3 个防御骰'); // 不是"用哪一组"
    // 骰片池子应带 kind（供界面显示「防N」）且 id 与选项 id 同源
    expect(g.pending.pick?.pool.every((x) => x.kind === 'defense')).toBe(true);
    const comboId = g.pending.options[0].id;
    const scrambled = comboId.split(',').reverse().join(','); // 故意乱序（＝界面的"点击顺序"）
    expect(scrambled).not.toBe(comboId);
    expect(() => applyAction(g, { t: 'challengePick', id: scrambled })).not.toThrow(); // 顺序无关
    applyAction(g, { t: 'challengeStep' }); // 真正结算（弃骰 + 循环）
    expect(g.players.A.areas.defense.length).toBeLessThan(4); // 确实弃掉了防御骰
  });

  it('蛮王之牙：**每组"再次发动"都重弹技能名**（发动帧 + "再次发动"各一次）', () => {
    const g = make();
    skipInitialReroll(g);
    g.phase = 'main';
    g.activePlayer = 'B';
    g.challenge!.turn = 1;
    g.challenge!.resumeAt = 4; // z07-4
    g.challenge!.driven = [die('a1', 4), die('a2', 4), die('b1', 5), die('b2', 5)];
    setA(g, {}); // 0 防御骰（免代决）
    g.players.B.areas.defense = [];
    fxTake();
    const announces: string[] = [];
    const nextGroupConsumed: number[] = [];
    const drain = (): void => {
      for (const e of fxTake()) {
        if (e.kind !== 'legendSkill' || e.skillKey !== 'z07-4') continue;
        if (e.announce) announces.push(e.skillName);
        if (e.consumed.length > 0) nextGroupConsumed.push(e.consumed.length);
      }
    };
    let guard = 0;
    while (g.activePlayer === 'B' && guard++ < 40) {
      if (g.pendingAttack) {
        applyAction(g, { t: 'block' });
        drain();
        continue;
      }
      if (g.pending?.kind === 'challengePick') {
        applyAction(g, { t: 'challengePick', id: g.pending.options[0].id });
        drain();
        continue;
      }
      applyAction(g, { t: 'challengeStep' });
      drain();
    }
    // 发动帧（第 1 组）＋ "再次发动"帧（第 2 组）＝ **恰好 2 次**弹名
    expect(announces).toEqual(['蛮王之牙', '蛮王之牙']);
    // 且两次都"有驱骰进槽"（各 2 颗）
    expect(nextGroupConsumed).toEqual([2, 2]);
  });

  it('不屈咆哮：选组（顺点）→ 弃骰 两个代决按序、不报错（回归）', () => {
    const g = make();
    skipInitialReroll(g);
    g.phase = 'main';
    g.activePlayer = 'B';
    g.challenge!.count = 1;
    g.challenge!.turn = 1;
    g.challenge!.resumeAt = 2; // z07-2 不屈咆哮
    g.challenge!.driven = [die('a1', 1), die('a2', 2), die('a3', 3), die('a4', 4)];
    setA(g, { defense: [die('d1', 3, 'defense'), die('d2', 4, 'defense')] });
    applyAction(g, { t: 'challengeStep' }); // ① 选组（顺点段 ≥2）
    expect(g.pending?.kind).toBe('challengePick');
    if (g.pending?.kind !== 'challengePick') throw new Error('expect challengePick');
    expect(g.pending.prompt).toContain('用哪一组驱动骰');
    applyAction(g, { t: 'challengePick', id: g.pending.options[0].id });
    applyAction(g, { t: 'challengeStep' }); // ② 弃骰（=计数）
    expect(g.pending?.kind).toBe('challengePick');
    if (g.pending?.kind !== 'challengePick') throw new Error('expect challengePick');
    const discId = g.pending.options[0].id;
    expect(() => applyAction(g, { t: 'challengePick', id: discId })).not.toThrow(); // 不再报 not a defense die
    applyAction(g, { t: 'challengeStep' }); // 结算
    expect(g.players.A.areas.defense.length).toBe(1); // 弃 1（计数 1）
  });

  it('不屈咆哮：弃骰代决 n=2（多颗组合）→ **乱序确认不报错**（回归：骰片点击顺序）', () => {
    const g = make();
    skipInitialReroll(g);
    g.phase = 'main';
    g.activePlayer = 'B';
    g.challenge!.count = 2;
    g.challenge!.turn = 1;
    g.challenge!.resumeAt = 2; // z07-2
    g.challenge!.driven = [die('a1', 1), die('a2', 2), die('a3', 3), die('a4', 4), die('a5', 5)];
    setA(g, { defense: [die('d1', 3, 'defense'), die('d2', 4, 'defense'), die('d3', 5, 'defense')] });
    applyAction(g, { t: 'challengeStep' }); // ① 选组（顺点段 ≥2）
    if (g.pending?.kind !== 'challengePick') throw new Error('expect challengePick');
    applyAction(g, { t: 'challengePick', id: g.pending.options[0].id });
    applyAction(g, { t: 'challengeStep' }); // ② 弃骰（=计数 2）
    if (g.pending?.kind !== 'challengePick') throw new Error('expect challengePick');
    expect(g.pending.pick?.n).toBe(2);
    const scrambled = g.pending.options[0].id.split(',').reverse().join(',');
    expect(scrambled).not.toBe(g.pending.options[0].id);
    expect(() => applyAction(g, { t: 'challengePick', id: scrambled })).not.toThrow();
    applyAction(g, { t: 'challengeStep' });
    expect(g.players.A.areas.defense.length).toBe(1); // 弃 2
  });

  it('尘起：剩余驱骰→防御区（先移骰）→ 问顺序 → 用全部攻击骰攻击', () => {
    const g = make();
    setA(g, {});
    g.players.B.areas.defense = [];
    g.players.B.areas.attack = [die('ax', 4, 'attack'), die('ay', 2, 'attack')];
    g.challenge!.driven = [die('r1', 5), die('r2', 6)];
    applyChallengeSkill(g, Z07, SK('z07-5'), []);
    expect(g.challenge!.deferred).toMatchObject({ skillId: 'z07-5' });
    resolveLegendDeferred(g, Z07); // ① 驱骰 → 防御区
    expect(vals(g.players.B.areas.defense)).toEqual([5, 6]);
    resolveLegendDeferred(g, Z07); // ② 攻击区 2 颗 → 弹顺序面板
    expect(g.pending?.kind).toBe('challengePick');
    if (g.pending?.kind !== 'challengePick') throw new Error('expect challengePick');
    expect(g.pending.options.map((o) => o.id)).toEqual(['asc', 'desc']);
  });

  it('围攻：挑战者 6 点攻击骰造成伤害时取消（计数 −1）', () => {
    const g = make();
    g.challenge!.count = 2;
    g.players.A.life = 50;
    g.players.B.life = 30;
    settleAttack(
      g,
      { attacker: 'A', value: 6, baseValue: 6, sourceValue: 6, unblockable: false, physical: true },
      { blocked: false, blockedForTriggers: false, damageDealt: 6, applyDamage: true },
    );
    expect(g.players.B.life).toBe(30); // 伤害被取消
    expect(g.challenge!.count).toBe(1); // 计数 −1
  });

  it('围攻：非 6 点攻击骰不取消', () => {
    const g = make();
    g.challenge!.count = 2;
    g.players.B.life = 30;
    settleAttack(
      g,
      { attacker: 'A', value: 5, baseValue: 5, sourceValue: 5, unblockable: false, physical: true },
      { blocked: false, blockedForTriggers: false, damageDealt: 5, applyDamage: true },
    );
    expect(g.players.B.life).toBe(25); // 照常受伤
    expect(g.challenge!.count).toBe(2); // 计数不减
  });

  it('围攻：**028「陨落」把 3 点骰"视为6"** → 按攻击点判定 → 取消（回归：不再漏挡）', () => {
    const g = make();
    g.challenge!.count = 2;
    g.players.B.life = 30;
    // 陨落生效时的 PendingAttack：baseValue=6（视为6）、sourceValue=3（真骰原始点数）
    settleAttack(
      g,
      { attacker: 'A', value: 6, baseValue: 6, sourceValue: 3, unblockable: false, physical: true, blockKind: 'attack' },
      { blocked: false, blockedForTriggers: false, damageDealt: 6, applyDamage: true },
    );
    expect(g.players.B.life).toBe(30); // 取消
    expect(g.challenge!.count).toBe(1); // 计数 −1
  });

  it('围攻：**虚拟 6 点攻击**（无实体骰）也算 → 取消', () => {
    const g = make();
    g.challenge!.count = 1;
    g.players.B.life = 30;
    settleAttack(
      g,
      { attacker: 'A', value: 6, baseValue: 6, unblockable: false, physical: false },
      { blocked: false, blockedForTriggers: false, damageDealt: 6, applyDamage: true },
    );
    expect(g.players.B.life).toBe(30); // 取消
    expect(g.challenge!.count).toBe(0); // 计数 −1
  });

  it('围攻：**4 点攻击 +2 加成 = 6 点伤害** → 不是 6 点攻击 → 不取消', () => {
    const g = make();
    g.challenge!.count = 2;
    g.players.B.life = 30;
    settleAttack(
      g,
      { attacker: 'A', value: 6, baseValue: 4, sourceValue: 4, bonusValue: 2, unblockable: false, physical: true },
      { blocked: false, blockedForTriggers: false, damageDealt: 6, applyDamage: true },
    );
    expect(g.players.B.life).toBe(24); // 照常受伤
    expect(g.challenge!.count).toBe(2); // 计数不减
  });

  it('围攻：**触发时弹技能名**（发 legendSkill{skillKey:z07-x, announce:true}）', () => {
    const g = make();
    g.challenge!.count = 2;
    g.players.B.life = 30;
    fxTake();
    settleAttack(
      g,
      { attacker: 'A', value: 6, baseValue: 6, sourceValue: 6, unblockable: false, physical: true },
      { blocked: false, blockedForTriggers: false, damageDealt: 6, applyDamage: true },
    );
    const ev = fxTake().find(
      (e): e is Extract<FxEvent, { kind: 'legendSkill' }> => e.kind === 'legendSkill' && e.skillKey === 'z07-x',
    );
    expect(ev).toBeTruthy();
    expect(ev!.skillName).toBe('围攻'); // 名称取自数据、不硬编码
    expect(ev!.announce).toBe(true); // 触发帧＝发动帧 → 弹名
    expect(ev!.consumed).toEqual([]);
    expect(ev!.spawn).toEqual([]);
    expect(g.challenge!.count).toBe(1); // 结算照旧
  });
});
