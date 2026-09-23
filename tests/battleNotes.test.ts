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

  it('D：022 处刑通牒 —— 计数 ≥1 才显示', () => {
    const g = mk(['022', '023', '024']);
    arm(g, 'A', '022', 'right');
    expect(notes(g, 'A')).toEqual([]);
    art(g, 'A', '022').count = 1;
    expect(notes(g, 'A')).toEqual([
      { label: '处刑通牒', text: '使用攻击骰前，可令本次伤害 +1 且不可抵挡，或 +5' },
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

  it('B：025 屠虎·横贯·触发 —— 对方有可弃置、且点数小于「可用攻击骰」的能力骰时才显示', () => {
    const g = mk(['025', '026', '027']);
    arm(g, 'A', '025', 'right'); // 横贯（持续 + 触发·右）
    putDie(g, 'A', 'attack', 3);
    putDie(g, 'B', 'defense', 2); // 2 < 3 → 可弃置
    expect(notes(g, 'A')).toEqual([
      { label: '横贯', text: '攻击被抵挡时，可弃置对方 1 颗点数小于该攻击的能力骰' },
    ]);

    // 对方没有严格小于最高可用攻击点数的骰 → 不显示
    const g2 = mk(['025', '026', '027']);
    arm(g2, 'A', '025', 'right');
    putDie(g2, 'A', 'attack', 3);
    putDie(g2, 'B', 'defense', 5);
    expect(notes(g2, 'A')).toEqual([]);

    // 自己没有攻击骰（无法发动攻击）→ 不显示
    const g3 = mk(['025', '026', '027']);
    arm(g3, 'A', '025', 'right');
    putDie(g3, 'B', 'defense', 2);
    expect(notes(g3, 'A')).toEqual([]);

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

  it('030：寰宇飞升（持续）由 attackDamageBonus 自动显示为「第一次攻击将 +3 伤害」', () => {
    const g = mk(['001', '002', '003'], ['028', '029', '030']);
    arm(g, 'B', '030', 'left');
    g.activePlayer = 'A';
    g.attacksThisTurn.A = 0;
    expect(notes(g, 'A')).toContainEqual({ label: '寰宇飞升', text: '本回合第一次攻击将 +3 伤害' });
    // 失去持续式后（必杀已用）不再显示
    art(g, 'B', '030').continuousLost = true;
    expect(notes(g, 'A').some((n) => n.label === '寰宇飞升')).toBe(false);
  });

  it('A：025 横贯·持续（本回合第 2 次攻击）→ 文案点明「第二次攻击」', () => {
    const g = mk(['025', '026', '027']);
    arm(g, 'A', '025', 'right');
    g.attacksThisTurn.A = 1; // 本回合已是第 2 次攻击
    expect(notes(g, 'A')).toContainEqual({ label: '横贯', text: '本回合第二次攻击将 +2 伤害' });
    // 第 1 次攻击时该持续加成不生效 → 不显示
    g.attacksThisTurn.A = 0;
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