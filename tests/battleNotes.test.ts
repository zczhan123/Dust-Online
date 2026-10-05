import { describe, it, expect } from 'vitest';
import { createGame, skipInitialReroll } from '../src/core/engine/game';
import { battleNotes } from '../src/core/engine/battleNotes';
import type { DiceKind, GameState, PlayerId } from '../src/core/model/types';

/** 纯读函数测试：构造局面后直接把 phase 设成 main（不走完整流程，避免无关的尘起决策干扰） */
const mk = (heroA: [string, string, string], heroB: [string, string, string] = ['010', '011', '012']): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA, heroB });
  skipInitialReroll(g);
  g.phase = 'main';
  // 骰子清空：只读测试要精确控制「有无骰子」这一前提
  for (const who of ['A', 'B'] as PlayerId[]) {
    g.players[who].areas.attack = [];
    g.players[who].areas.defense = [];
    g.players[who].areas.meditation = [];
  }
  return g;
};
const art = (g: GameState, who: PlayerId, id: string) => g.players[who].artifacts.find((a) => a.id === id)!;
/** 直接标记某神器某侧为已激活（legacy 副本：只影响只读判定） */
const arm = (g: GameState, who: PlayerId, id: string, side: 'left' | 'right'): void => {
  const a = art(g, who, id);
  a.activeMarkerSide = side;
  a.armedSide = side;
  a.armedTurn = g.turnIndex;
};
const putDie = (g: GameState, who: PlayerId, kind: DiceKind, value: number): void => {
  g.players[who].areas[kind].push({ id: `${who}-${kind}-${value}-${g.players[who].areas[kind].length}`, value, kind });
};
const notes = (g: GameState, who: PlayerId) => battleNotes(g, who);

describe('战斗提示 battleNotes（主要阶段、只读状态）', () => {
  it('非主要阶段 / 无任何攻击相关效果 → 空', () => {
    const g = mk(['001', '002', '003']);
    expect(notes(g, 'A')).toEqual([]);
    g.phase = 'refill';
    expect(notes(g, 'A')).toEqual([]);
  });

  it('A：攻击伤害加成（004 锋芒计数 3）→ 精确一条', () => {
    const g = mk(['004', '005', '006']);
    arm(g, 'A', '004', 'right');
    art(g, 'A', '004').count = 3;
    // 无骰时不影响 A 类显示（A 类只看加成本身）
    expect(notes(g, 'A')).toEqual([{ label: '锋芒', text: '攻击伤害 +3' }]);
  });

  it('A：015 绝境天神 / 020 熊之心 / 021 野火燎原 的加成文案（同属性取最大，只显示实际生效的那条）', () => {
    const g1 = mk(['013', '014', '015']);
    arm(g1, 'A', '015', 'right');
    art(g1, 'A', '015').count = 2;
    expect(notes(g1, 'A')).toEqual([{ label: '绝境天神', text: '攻击伤害 +2' }]);

    // 020 熊之心（左，+2）与 021 野火燎原（+1）并存 → 取最大，只显示 +2
    const g2 = mk(['019', '020', '021']);
    arm(g2, 'A', '020', 'left');
    art(g2, 'A', '020').count = 2;
    arm(g2, 'A', '021', 'left');
    art(g2, 'A', '021').count = 1;
    expect(notes(g2, 'A')).toEqual([{ label: '熊之心', text: '攻击伤害 +2' }]);
  });

  it('A：带来源的本回合 Buff（如「献祭」②）也会显示', () => {
    const g = mk(['016', '017', '018']);
    g.players.A.buffs.push({ attr: 'attackDamage', add: 2, duration: 'thisTurn', source: '献祭' });
    expect(notes(g, 'A')).toEqual([{ label: '献祭', text: '攻击伤害 +2' }]);
  });

  it('B：004 锋芒·触发 —— 需 1 攻击骰 + 1 冥想骰，缺一不显示', () => {
    const g = mk(['004', '005', '006']);
    arm(g, 'A', '004', 'right');
    putDie(g, 'A', 'attack', 3);
    putDie(g, 'A', 'meditation', 2);
    expect(notes(g, 'A')).toEqual([{ label: '锋芒', text: '攻击被抵挡时，可追加 2 真实伤害' }]);

    const g2 = mk(['004', '005', '006']);
    arm(g2, 'A', '004', 'right');
    putDie(g2, 'A', 'attack', 3); // 只有攻击骰 → 支付不起
    expect(notes(g2, 'A')).toEqual([]);

    const g3 = mk(['004', '005', '006']); // 未激活 → 不显示
    putDie(g3, 'A', 'attack', 3);
    putDie(g3, 'A', 'meditation', 2);
    expect(notes(g3, 'A')).toEqual([]);
  });

  it('B：013 雷暴·触发 —— 需 1 冥想骰；021 满计数（=5）才显示半伤', () => {
    const g = mk(['013', '014', '015']);
    arm(g, 'A', '013', 'right');
    expect(notes(g, 'A')).toEqual([]); // 无冥想骰
    putDie(g, 'A', 'meditation', 4);
    expect(notes(g, 'A')).toEqual([{ label: '雷暴', text: '攻击被抵挡时，可将最多 2 个冥想骰移到攻击骰区' }]);

    const g2 = mk(['019', '020', '021']);
    arm(g2, 'A', '021', 'left');
    art(g2, 'A', '021').count = 4;
    // 计数 1+ 的「攻击伤害 +1」在计数 4 时就已生效（半伤要到 5 才生效）
    expect(notes(g2, 'A')).toEqual([{ label: '野火燎原', text: '攻击伤害 +1' }]);
    art(g2, 'A', '021').count = 5;
    expect(notes(g2, 'A')).toEqual([
      { label: '野火燎原', text: '攻击伤害 +1' },
      { label: '野火燎原', text: '攻击被抵挡时，仍造成一半伤害（向下取整）' },
    ]);
  });

  it('C：017 冥界行走（含取整字样）/ 001 中央突破不可抵挡', () => {
    const g = mk(['016', '017', '018']);
    arm(g, 'A', '017', 'right');
    expect(notes(g, 'A')).toEqual([
      {
        label: '冥界行走',
        text: '攻击造成伤害后，回复该点数一半的生命（向上取整）；若攻击点数为 6，则受 3 真实伤害',
      },
    ]);

    const g2 = mk(['001', '002', '003']);
    g2.unblockableThisTurn = true;
    expect(notes(g2, 'A')).toEqual([{ label: '中央突破', text: '本回合攻击不可抵挡' }]);
  });

  it('A：L10 迟来的正义 —— 攻击伤害 +X（X＝尘落，最大 4）', () => {
    const g = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['028', '029', '030'],
      heroB: ['004', '005', '006'],
      legendA: 'L10',
    });
    skipInitialReroll(g);
    g.phase = 'main';
    for (const who of ['A', 'B'] as PlayerId[]) {
      g.players[who].areas.attack = [];
      g.players[who].areas.defense = [];
      g.players[who].areas.meditation = [];
    }
    g.dustfall = 0;
    expect(notes(g, 'A').some((n) => n.label === '迟来的正义')).toBe(false); // 尘落 0 → 无加成
    g.dustfall = 2;
    expect(notes(g, 'A')).toEqual([{ label: '迟来的正义', text: '攻击伤害 +2（＝当前尘落，最大 4）' }]);
    g.dustfall = 9;
    expect(notes(g, 'A')).toEqual([{ label: '迟来的正义', text: '攻击伤害 +4（＝当前尘落，最大 4）' }]);
  });

  it('A：L09 吞虎之狼 —— **常驻提醒**（不看已攻击次数）；不持 L09 则不显示', () => {
    const g = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['025', '026', '027'],
      heroB: ['004', '005', '006'],
      legendA: 'L09',
    });
    skipInitialReroll(g);
    g.phase = 'main';
    for (const who of ['A', 'B'] as PlayerId[]) {
      g.players[who].areas.attack = [];
      g.players[who].areas.defense = [];
      g.players[who].areas.meditation = [];
    }
    // 0/1/2/5 次攻击都显示（常驻）
    for (const n of [0, 1, 2, 5]) {
      g.attacksThisTurn.A = n;
      expect(notes(g, 'A')).toContainEqual({ label: '吞虎之狼', text: '本回合的第 3 次攻击伤害 +3' });
    }
    // 对照：不持 L09 → 不显示
    const g2 = createGame({ seed: 1, firstPlayer: 'A', heroA: ['025', '026', '027'], heroB: ['004', '005', '006'] });
    skipInitialReroll(g2);
    g2.phase = 'main';
    for (const who of ['A', 'B'] as PlayerId[]) {
      g2.players[who].areas.attack = [];
      g2.players[who].areas.defense = [];
      g2.players[who].areas.meditation = [];
    }
    expect(notes(g2, 'A').some((n) => n.label === '吞虎之狼')).toBe(false);
  });

  it('D：022 处刑通牒 —— 计数 ≥1 才显示；带 L08「只为赏金而来」时追加提示', () => {
    const g = mk(['022', '023', '024']);
    arm(g, 'A', '022', 'right');
    expect(notes(g, 'A')).toEqual([]);
    art(g, 'A', '022').count = 1;
    expect(notes(g, 'A')).toEqual([
      { label: '处刑通牒', text: '使用攻击骰前，可令本次伤害 +1 且不可抵挡，或 +5' },
    ]);

    // L08：同一条件下追加"发动后还可额外启动 1 个「启动式」技能"
    const g2 = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['022', '023', '024'],
      heroB: ['004', '005', '006'],
      legendA: 'L08',
    });
    skipInitialReroll(g2);
    g2.phase = 'main';
    for (const who of ['A', 'B'] as PlayerId[]) {
      g2.players[who].areas.attack = [];
      g2.players[who].areas.defense = [];
      g2.players[who].areas.meditation = [];
    }
    arm(g2, 'A', '022', 'right');
    art(g2, 'A', '022').count = 1;
    expect(notes(g2, 'A')).toEqual([
      {
        label: '处刑通牒',
        text: '使用攻击骰前，可令本次伤害 +1 且不可抵挡，或 +5（发动后还可额外启动 1 个「启动式」技能）',
      },
    ]);
  });

  it('E：023 畏惧（本回合攻击减半）', () => {
    const g = mk(['022', '023', '024']);
    g.players.A.attackHalvedNextTurn = true;
    expect(notes(g, 'A')).toEqual([{ label: '畏惧', text: '本回合攻击伤害减半' }]);
    // 只影响被标记的一方
    expect(notes(g, 'B')).toEqual([]);
  });

  it('A：025 屠虎·奇袭 —— 存在「点数不在对方区域」的能力骰时才显示', () => {
    const g = mk(['025', '026', '027']);
    arm(g, 'A', '025', 'left'); // 奇袭（持续·左）
    putDie(g, 'A', 'defense', 5); // 对方没有 5 点 → 可视为攻击骰
    expect(notes(g, 'A')).toEqual([{ label: '奇袭', text: '可将点数不在对方区域的能力骰视为攻击骰' }]);

    // 对方存在同点数 → 不可视为 → 不显示
    const g2 = mk(['025', '026', '027']);
    arm(g2, 'A', '025', 'left');
    putDie(g2, 'A', 'defense', 5);
    putDie(g2, 'B', 'defense', 5);
    expect(notes(g2, 'A')).toEqual([]);

    // 未激活 → 不显示
    const g3 = mk(['025', '026', '027']);
    putDie(g3, 'A', 'defense', 5);
    expect(notes(g3, 'A')).toEqual([]);
  });

  it('D：027 寒光·必杀 —— 神器上有骰子时显示，用尽后不显示', () => {
    const g = mk(['025', '026', '027']);
    const card = art(g, 'A', '027');
    card.heldDice = [{ id: '027-held-3', value: 3 }];
    expect(notes(g, 'A')).toEqual([
      {
        label: '凛冽之音',
        text: '使用攻击骰前：可将神器上 1 颗骰移入对应区域，或移除它并弃置对方同点数的能力骰',
      },
    ]);
    card.heldDice = [];
    expect(notes(g, 'A')).toEqual([]);
  });

  it('B：025 屠虎·横贯·触发 —— 对方有可弃置、且点数小于「可用攻击骰」的能力骰时才显示（另：持续部分常驻提醒）', () => {
    const g = mk(['025', '026', '027']);
    arm(g, 'A', '025', 'right'); // 横贯（持续 + 触发·右）
    putDie(g, 'A', 'attack', 3);
    putDie(g, 'B', 'defense', 2); // 2 < 3 → 可弃置
    expect(notes(g, 'A')).toEqual([
      { label: '横贯', text: '本回合的第 2 次攻击伤害 +2' }, // 常驻（持续）
      { label: '横贯', text: '攻击被抵挡时，可弃置对方 1 颗点数小于该攻击的能力骰' }, // 触发
    ]);

    // 对方没有严格小于最高可用攻击点数的骰 → 触发不显示（**但持续那条常驻仍在**）
    const g2 = mk(['025', '026', '027']);
    arm(g2, 'A', '025', 'right');
    putDie(g2, 'A', 'attack', 3);
    putDie(g2, 'B', 'defense', 5);
    expect(notes(g2, 'A')).toEqual([{ label: '横贯', text: '本回合的第 2 次攻击伤害 +2' }]);

    // 自己没有攻击骰（无法发动攻击）→ **触发**不显示（持续那条常驻仍在）
    const g3 = mk(['025', '026', '027']);
    arm(g3, 'A', '025', 'right');
    putDie(g3, 'B', 'defense', 2);
    expect(notes(g3, 'A')).toEqual([{ label: '横贯', text: '本回合的第 2 次攻击伤害 +2' }]);

    // 未激活触发侧 → 不显示
    const g4 = mk(['025', '026', '027']);
    putDie(g4, 'A', 'attack', 3);
    putDie(g4, 'B', 'defense', 2);
    expect(notes(g4, 'A')).toEqual([]);
  });

  it('综合：条目顺序按攻击时间线（加成 → 攻击前选择 → 被抵挡 → 伤害后 → 负面）', () => {
    const g = mk(['022', '023', '024']);
    arm(g, 'A', '022', 'right');
    art(g, 'A', '022').count = 2;
    g.players.A.attackHalvedNextTurn = true;
    expect(notes(g, 'A')).toEqual([
      { label: '处刑通牒', text: '使用攻击骰前，可令本次伤害 +1 且不可抵挡，或 +5' },
      { label: '畏惧', text: '本回合攻击伤害减半' },
    ]);
  });
});

describe('显示时机（用户反馈：被问"是否抵挡"时不该显示自己"下次攻击"的提示）', () => {
  const mk22 = () => {
    const g = mk(['022', '023', '024']);
    arm(g, 'A', '022', 'right');
    art(g, 'A', '022').count = 2;
    return g;
  };

  it('非自己回合 / 正被要求抵挡 / 待决策属于别人 → 都不显示；自己回合或"使用攻击骰前"待决策 → 显示', () => {
    const g = mk22();
    expect(battleNotes(g, 'A').length).toBeGreaterThan(0); // 自己回合 → 显示
    expect(battleNotes(g, 'B')).toEqual([]); // 不是他的回合 → 空

    g.pendingAttack = { attacker: 'B', value: 3, unblockable: false, physical: true };
    expect(battleNotes(g, 'A')).toEqual([]); // 被要求抵挡 → 空

    g.pendingAttack = null;
    g.pending = { kind: 'weiyaPick', player: 'B', value: 4, reason: 'attack' };
    expect(battleNotes(g, 'A')).toEqual([]); // 待决策属于对方 → 空

    g.pending = { kind: 'sijiChuxing', player: 'A', costSlots: [] };
    expect(battleNotes(g, 'A').length).toBeGreaterThan(0); // 022 前置待决策属于自己 → 仍显示
  });
});

describe('战斗提示：028 天罚 / 030 寰宇飞升', () => {
  it('028：白昼之火 / 陨落按当前状态显示（可用 → 精确文案）', () => {
    const g = mk(['028', '029', '030']);
    g.tianfa.A = { blockKind: 'meditation', value: 6, damageCount: 0 };
    expect(notes(g, 'A')).toContainEqual({
      label: '白昼之火',
      text: '本回合攻击点数视为 6，且对方只能用冥想骰抵挡',
    });
    g.tianfa.A = { blockKind: 'attack', value: 6, damageCount: 0 };
    expect(notes(g, 'A')).toContainEqual({
      label: '陨落',
      text: '本回合攻击点数视为 6，且对方只能用攻击骰抵挡',
    });
    // 未激活 → 不出现
    g.tianfa.A = null;
    expect(notes(g, 'A').some((n) => n.label === '白昼之火' || n.label === '陨落')).toBe(false);
  });

  it('030：寰宇飞升（持续）→ **对方持有**时我方也显示（双向）；自己尘落≥4 的「迟来的正义」会取最大盖过它', () => {
    const g = mk(['001', '002', '003'], ['028', '029', '030']);
    arm(g, 'B', '030', 'left');
    g.activePlayer = 'A';
    g.attacksThisTurn.A = 0;
    expect(notes(g, 'A')).toContainEqual({ label: '寰宇飞升', text: '本回合第一次攻击将 +3 伤害' });
    // 失去持续式后（必杀已用）不再显示
    art(g, 'B', '030').continuousLost = true;
    expect(notes(g, 'A').some((n) => n.label === '寰宇飞升')).toBe(false);

    // L10 局：持「迟来的正义」且尘落 ≥4 → 取最大 → 只显示迟来的正义（+4 盖过寰宇飞升 +3）
    const g2 = createGame({
      seed: 1,
      firstPlayer: 'A',
      heroA: ['028', '029', '030'],
      heroB: ['001', '002', '003'],
      legendA: 'L10',
    });
    skipInitialReroll(g2);
    g2.phase = 'main';
    for (const who of ['A', 'B'] as PlayerId[]) {
      g2.players[who].areas.attack = [];
      g2.players[who].areas.defense = [];
      g2.players[who].areas.meditation = [];
    }
    arm(g2, 'A', '030', 'left');
    g2.attacksThisTurn.A = 0;
    g2.dustfall = 4;
    const labels = notes(g2, 'A').map((n) => n.label);
    expect(labels).toContain('迟来的正义');
    expect(labels).not.toContain('寰宇飞升');
  });

  it('A：025 横贯·持续 → **常驻提醒**（不看已攻击次数）；且与生效加成条目**不重复**', () => {
    const g = mk(['025', '026', '027']);
    arm(g, 'A', '025', 'right');
    // 0/1/5 次攻击都显示（常驻）
    for (const n of [0, 1, 5]) {
      g.attacksThisTurn.A = n;
      expect(notes(g, 'A')).toContainEqual({ label: '横贯', text: '本回合的第 2 次攻击伤害 +2' });
    }
    // 第 2 次攻击（横贯正是生效加成）→ **只出现常驻那一条**（不重复渲染）
    g.attacksThisTurn.A = 1;
    expect(notes(g, 'A').filter((n) => n.label === '横贯')).toHaveLength(1);
    // 对照：未激活 → 不显示
    g.players.A.artifacts.find((a) => a.id === '025')!.activeMarkerSide = null;
    expect(notes(g, 'A').some((n) => n.label === '横贯')).toBe(false);
  });
});

describe('战斗提示：031 血祭 / 032 恶意', () => {
  it('031：血祭（持续）按计数登记为负面状态提示', () => {
    const g = mk(['031', '032', '033']);
    arm(g, 'A', '031', 'left');
    art(g, 'A', '031').count = 2;
    expect(notes(g, 'A')).toContainEqual({
      label: '血祭',
      text: '攻击造成伤害后，你受到 2 点真实伤害（计数）',
    });
  });

  it('032：恶意（持续）由 attackDamageBonus 自动显示（floor(冥想/2)）', () => {
    const g = mk(['031', '032', '033']);
    arm(g, 'A', '032', 'right');
    for (let v = 1; v <= 4; v++) putDie(g, 'A', 'meditation', v);
    expect(notes(g, 'A')).toContainEqual({ label: '恶意', text: '攻击伤害 +2' });
  });
});

describe('战斗提示 · 传奇英雄面板（L01–L03）', () => {
  /** 带传奇面板的只读局面（清空骰子） */
  const mkL = (
    heroA: [string, string, string],
    legendA: string,
    heroB: [string, string, string] = ['010', '011', '012'],
  ): GameState => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA, heroB, legendA });
    skipInitialReroll(g);
    g.phase = 'main';
    for (const who of ['A', 'B'] as PlayerId[]) {
      g.players[who].areas.attack = [];
      g.players[who].areas.defense = [];
      g.players[who].areas.meditation = [];
    }
    return g;
  };

  it('残影：影袭本回合仍可启动 → 精确一条；用满 2 次后消失', () => {
    const g = mkL(['004', '005', '006'], 'L02');
    arm(g, 'A', '005', 'left');
    putDie(g, 'A', 'defense', 3); // 影袭需 ≥2 点骰；无攻击骰 → 不出「锋芒」提示
    expect(notes(g, 'A')).toEqual([{ label: '残影', text: '「影袭」本回合还可启动 2 次' }]);
    g.skillsUsedThisTurn.push('A:yingle.yingxi');
    expect(notes(g, 'A')).toEqual([{ label: '残影', text: '「影袭」本回合还可启动 1 次' }]);
    g.skillsUsedThisTurn.push('A:yingle.yingxi');
    expect(notes(g, 'A')).toEqual([]);
  });

  it('暗夜凶神：锋芒可发动且不祥计数 <3 → 出现；满 3 层后消失', () => {
    const g = mkL(['004', '005', '006'], 'L02');
    arm(g, 'A', '004', 'right');
    putDie(g, 'A', 'attack', 3);
    putDie(g, 'A', 'meditation', 2);
    expect(notes(g, 'A')).toEqual([
      { label: '锋芒', text: '攻击被抵挡时，可追加 2 真实伤害' },
      { label: '暗夜凶神', text: '通过「锋芒」取消对方防御骰后，可使「不祥」计数 +1（最高 3 层）' },
    ]);
    art(g, 'A', '004').count = 3;
    expect(notes(g, 'A').some((n) => n.label === '暗夜凶神')).toBe(false);
  });

  it('无上剑术：有 5 点攻击/防御骰（或可置换）→ 出现；否则不出现', () => {
    const g = mkL(['010', '011', '012'], 'L04');
    expect(notes(g, 'A').some((n) => n.label === '无上剑术')).toBe(false); // 无骰
    putDie(g, 'A', 'attack', 5);
    expect(notes(g, 'A')).toEqual([
      { label: '无上剑术', text: '使用 5 点攻击骰 → 回复 1 生命；使用 5 点防御骰 → 造成 1 点真实伤害' },
    ]);
    // 清掉 5 点骰；010 真实之剑已激活且有 ≥2 颗骰 → 「可置换出 5 点」也算可用
    const g2 = mkL(['010', '011', '012'], 'L04');
    arm(g2, 'A', '010', 'left'); // 真实之剑（持续·置换）
    putDie(g2, 'A', 'attack', 3);
    putDie(g2, 'A', 'meditation', 2);
    expect(notes(g2, 'A').some((n) => n.label === '无上剑术')).toBe(true);
  });

  it('无尽追猎：攻击骰区恰剩 1 颗 → 出现（精确一条）；多于 1 颗或没有攻击骰 → 不出现', () => {
    const g = mkL(['019', '020', '021'], 'L07');
    putDie(g, 'A', 'attack', 3);
    putDie(g, 'A', 'attack', 4);
    expect(notes(g, 'A').some((n) => n.label === '无尽追猎')).toBe(false); // 有 2 颗 → 不是「最后 1 个攻击骰」
    g.players.A.areas.attack = [g.players.A.areas.attack[0]];
    expect(notes(g, 'A')).toEqual([
      { label: '无尽追猎', text: '攻击骰区仅剩 1 颗攻击骰 → 用它攻击时不可抵挡' },
    ]);
    g.players.A.areas.attack = [];
    expect(notes(g, 'A').some((n) => n.label === '无尽追猎')).toBe(false);
  });

  it('无法饶恕：对方有"点数＝可用攻击点数"的防御骰 → 出现；否则不出现', () => {
    const g = mkL(['013', '014', '015'], 'L05');
    expect(notes(g, 'A').some((n) => n.label === '无法饶恕')).toBe(false); // 无骰
    putDie(g, 'A', 'attack', 3);
    putDie(g, 'B', 'defense', 3);
    expect(notes(g, 'A')).toEqual([
      { label: '复仇之灵', text: '你的生命十位数变化后，立即进行 1 次无需冥想骰的额外「尘起行动」' },
      { label: '无法饶恕', text: '攻击造成伤害后，可弃置对方 1 个与该攻击点数相同的防御骰' },
    ]);
    // 对方没有同点数防御骰 → 不出现
    const g2 = mkL(['013', '014', '015'], 'L05');
    putDie(g2, 'A', 'attack', 3);
    putDie(g2, 'B', 'defense', 4);
    expect(notes(g2, 'A').some((n) => n.label === '无法饶恕')).toBe(false);
  });

  it('无光领域：设定状态后按 上升/下降 显示', () => {
    const g = mkL(['016', '017', '018'], 'L06');
    expect(notes(g, 'A').some((n) => n.label === '无光领域')).toBe(false);
    g.players.A.wuguang = 'up';
    expect(notes(g, 'A')).toEqual([{ label: '无光领域', text: '你的攻击点数视为上升 1 点（最大 6）' }]);
    g.players.A.wuguang = 'down';
    expect(notes(g, 'A')).toEqual([{ label: '无光领域', text: '你的攻击点数视为下降 1 点（最小 1）' }]);
  });

  it('拔城：主宰已激活且该侧技能未用 → 精确一条', () => {
    const g = mkL(['007', '008', '009'], 'L03');
    expect(notes(g, 'A').some((n) => n.label === '拔城')).toBe(false); // 未激活主宰 → 无
    arm(g, 'A', '007', 'left');
    expect(notes(g, 'A')).toEqual([
      {
        label: '拔城',
        text: '启动「主宰」技能后，若对方弃置的能力骰少于你消耗的，可视为以 5 点攻击 1 次并切换「主宰」技能',
      },
    ]);
    g.skillsUsedThisTurn.push('A:zhuzai.sweep');
    expect(notes(g, 'A').some((n) => n.label === '拔城')).toBe(false);
  });
});

describe('战斗提示·战术牌（T04 末路 / T05 狂热 / T06 残忍）', () => {
  it('T05 狂热：自己前 3 个回合内 → 精确一条「攻击伤害 +1」', () => {
    const g = mk(['001', '002', '003']);
    g.players.A.tactic = 'T05';
    g.activePlayer = 'A';
    g.players.A.turnsTaken = 1;
    expect(notes(g, 'A')).toEqual([{ label: '狂热', text: '攻击伤害 +1' }]);
    g.players.A.turnsTaken = 4; // 已过前 3 个回合
    expect(notes(g, 'A').some((n) => n.label === '狂热')).toBe(false);
  });

  it('T06 残忍：对方生命 ≤13 → 精确一条「攻击伤害 +5」；14 → 无', () => {
    const g = mk(['001', '002', '003']);
    g.players.A.tactic = 'T06';
    g.activePlayer = 'A';
    g.players.B.life = 13;
    expect(notes(g, 'A')).toEqual([{ label: '残忍', text: '攻击伤害 +5' }]);
    g.players.B.life = 14;
    expect(notes(g, 'A').some((n) => n.label === '残忍')).toBe(false);
  });

  it('T04 末路：持有即提醒（含第三列充能需求数值）', () => {
    const g = mk(['001', '002', '003']);
    g.players.A.tactic = 'T04';
    g.activePlayer = 'A';
    const req = art(g, 'A', '003').chargeReq ?? 0;
    expect(req).toBeGreaterThan(0);
    expect(notes(g, 'A')).toEqual([
      {
        label: '末路',
        text: `启动「必杀式」后，造成 ${req} 点真实伤害并回复 ${req} 点生命（＝第三列神器充能需求）`,
      },
    ]);
  });

  it('T09 慈悲：持有且未用 → 精确一条；用后不再出现', () => {
    const g = mk(['001', '002', '003']);
    g.players.A.tactic = 'T09';
    g.activePlayer = 'A';
    expect(notes(g, 'A')).toEqual([
      { label: '慈悲', text: '造成伤害时，可取消该伤害并回复等量生命（整局 1 次）' },
    ]);
    g.players.A.tacticOnceUsed = true;
    expect(notes(g, 'A').some((n) => n.label === '慈悲')).toBe(false);
  });
});

describe('战斗提示 · 本轮新增（019 / 013·A08 电刑 / A08 雷暴 / 001·C01 裁雨流 / A06 勾魂 / L05 复仇之灵）', () => {
  it('019 尘起（触发）：主要阶段提醒额外尘起；用过后不再出现', () => {
    const g = mk(['019', '020', '021']);
    arm(g, 'A', '019', 'left');
    expect(notes(g, 'A')).toEqual([
      { label: '尘起', text: '攻击造成伤害后，可立即进行 1 次无需冥想骰的额外「尘起行动」（每回合 1 次）' },
    ]);
    g.chenaiUsed.A = true;
    expect(notes(g, 'A').some((n) => n.label === '尘起')).toBe(false);
  });

  it('013 电刑 / A08 将至的电刑：需 2 冥想骰才提醒', () => {
    const g1 = mk(['013', '002', '003']);
    arm(g1, 'A', '013', 'left');
    expect(notes(g1, 'A').some((n) => n.label === '电刑')).toBe(false); // 无冥想骰
    putDie(g1, 'A', 'meditation', 1);
    putDie(g1, 'A', 'meditation', 2);
    expect(notes(g1, 'A')).toEqual([
      { label: '电刑', text: '使用攻击骰后，可消耗 2 冥想骰，视为以 1、2、3 点依次各攻击一次' },
    ]);

    const g2 = mk(['A08', '002', '003']);
    arm(g2, 'A', 'A08', 'left');
    putDie(g2, 'A', 'meditation', 1);
    putDie(g2, 'A', 'meditation', 2);
    expect(notes(g2, 'A')).toEqual([
      { label: '将至的电刑', text: '使用攻击骰后，可消耗 2 冥想骰，视为以 1、3、6 点依次各攻击一次' },
    ]);
  });

  it('A08 将至的雷暴（与 013 共用 key）：需 1 冥想骰才提醒（被抵挡时），按神器取卡面名', () => {
    const g = mk(['A08', '002', '003']);
    arm(g, 'A', 'A08', 'right');
    expect(notes(g, 'A').some((n) => n.label === '将至的雷暴')).toBe(false);
    putDie(g, 'A', 'meditation', 4);
    expect(notes(g, 'A')).toEqual([
      { label: '将至的雷暴', text: '攻击被抵挡时，可将最多 2 个冥想骰移到攻击骰区' },
    ]);
  });

  it('001 裁雨流：造成伤害后提示（每回合 3 次）；用满 3 次后消失', () => {
    const g = mk(['001', '002', '003']);
    arm(g, 'A', '001', 'right');
    expect(notes(g, 'A').some((n) => n.label === '裁雨流')).toBe(true);
    g.caiyuliuUsed = 3;
    expect(notes(g, 'A').some((n) => n.label === '裁雨流')).toBe(false);
  });

  it('C01 极之境·裁雨流 / A06 勾魂：造成伤害后提示', () => {
    const g1 = mk(['C01', '002', '003']);
    arm(g1, 'A', 'C01', 'right');
    expect(notes(g1, 'A').some((n) => n.label === '裁雨流')).toBe(true);

    const g2 = mk(['A06', '002', '003']);
    arm(g2, 'A', 'A06', 'left');
    expect(notes(g2, 'A').some((n) => n.label === '勾魂')).toBe(true);
  });

  it('L05 复仇之灵：常驻提醒', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['010', '011', '012'], legendA: 'L05' });
    skipInitialReroll(g);
    g.phase = 'main';
    for (const who of ['A', 'B'] as PlayerId[]) {
      g.players[who].areas.attack = [];
      g.players[who].areas.defense = [];
      g.players[who].areas.meditation = [];
    }
    expect(notes(g, 'A')).toEqual([
      { label: '复仇之灵', text: '你的生命十位数变化后，立即进行 1 次无需冥想骰的额外「尘起行动」' },
    ]);
  });
});
