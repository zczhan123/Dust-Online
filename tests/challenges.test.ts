import { describe, it, expect } from 'vitest';
import { CHALLENGES, slotPhrase, CHALLENGE_RULE_NOTES, challengeInertSkills } from '../src/core/content/challenges';

describe('挑战卡 · slotPhrase（文本记法）', () => {
  it('无槽 → （必检）', () => {
    expect(slotPhrase(null)).toBe('（必检）');
    expect(slotPhrase([])).toBe('（必检）');
  });

  it('① 统一可任选 → N颗[x/y点]', () => {
    expect(slotPhrase([{ kind: 'pips', count: 5, faces: [2, 5] }])).toBe('（满足5颗2/5点时发动）');
    expect(slotPhrase([{ kind: 'pips', count: 3, faces: [2, 5] }])).toBe('（满足3颗2/5点时发动）');
    expect(slotPhrase([{ kind: 'pips', count: 1, faces: [6] }])).toBe('（满足6点时发动）');
  });

  it('② 逐格指定 → 合并成一句', () => {
    expect(
      slotPhrase([
        { kind: 'pips', count: 1, faces: [1] },
        { kind: 'pips', count: 1, faces: [2] },
        { kind: 'pips', count: 1, faces: [3] },
        { kind: 'pips', count: 1, faces: [4] },
      ]),
    ).toBe('（满足1、2、3、4点时发动）');
    expect(
      slotPhrase([
        { kind: 'pips', count: 1, faces: [1] },
        { kind: 'pips', count: 1, faces: [4] },
        { kind: 'pips', count: 1, faces: [6] },
      ]),
    ).toBe('（满足1、4、6点时发动）');
  });

  it('② 逐格·**多点格** → 逐格渲染、不平铺（Z03 战争横扫）', () => {
    expect(
      slotPhrase([
        { kind: 'pips', count: 1, faces: [1, 2] },
        { kind: 'pips', count: 1, faces: [3, 4] },
        { kind: 'pips', count: 1, faces: [5, 6] },
      ]),
    ).toBe('（满足1/2点、3/4点、5/6点时发动）');
  });

  it('③ 特殊 → 同点 / 任意点 / 顺点', () => {
    expect(slotPhrase([{ kind: 'same', count: 2 }])).toBe('（满足2颗同点时发动）');
    expect(slotPhrase([{ kind: 'any', count: 3 }])).toBe('（满足3颗任意点时发动）');
    expect(slotPhrase([{ kind: 'straight', count: 4 }])).toBe('（满足4颗顺点时发动）');
  });

  it('Z01/Z02 数据与记法一致（抽查）', () => {
    const z1 = CHALLENGES.find((c) => c.id === 'Z01')!;
    expect(slotPhrase(z1.skills![2].slots)).toBe('（满足5颗2/5点时发动）');
    expect(slotPhrase(z1.skills![3].slots)).toBe('（满足3颗2/5点时发动）');
    const z2 = CHALLENGES.find((c) => c.id === 'Z02')!;
    expect(slotPhrase(z2.skills![2].slots)).toBe('（满足1、2、3、4点时发动）');
    expect(slotPhrase(z2.skills![3].slots)).toBe('（满足1、4、6点时发动）');
    expect(slotPhrase(z2.skills![5].slots)).toBe('（满足2颗同点时发动）');
    const z3 = CHALLENGES.find((c) => c.id === 'Z03')!;
    expect(slotPhrase(z3.skills![2].slots)).toBe('（满足3颗同点时发动）');
    expect(slotPhrase(z3.skills![3].slots)).toBe('（满足1/2点、3/4点、5/6点时发动）');
  });

  it('Z02 元数据：投 8 个驱动骰、计数上限 3、防御骰上限 4、生命 50', () => {
    const z2 = CHALLENGES.find((c) => c.id === 'Z02')!;
    expect(z2.rollDice).toBe(8);
    expect(z2.countCap).toBe(3);
    expect(z2.defenseCap).toBe(4);
    expect(z2.life).toBe(50);
    // 与"回合开始"那条的卡面文字必须一致（防两处漂移）
    expect(z2.skills![0].name).toBe('回合开始');
    expect(z2.skills![0].effect).toContain('8');
  });

  it('Z03 元数据：投 6 个驱动骰、生命 70、门槛 2、无防御骰上限', () => {
    const z3 = CHALLENGES.find((c) => c.id === 'Z03')!;
    expect(z3.rollDice).toBe(6);
    expect(z3.life).toBe(70);
    expect(z3.defenseMin).toBe(2);
    expect(z3.defenseCap).toBeUndefined();
    expect(z3.skills![0].name).toBe('回合开始');
    expect(z3.skills![0].effect).toContain('6');
    expect(z3.skills![2].slots).toEqual([{ kind: 'same', count: 3 }]); // 震荡斩击＝3 同点一组
    expect(z3.skills![3].slots).toEqual([
      { kind: 'pips', count: 1, faces: [1, 2] },
      { kind: 'pips', count: 1, faces: [3, 4] },
      { kind: 'pips', count: 1, faces: [5, 6] },
    ]);
  });
});

describe('挑战模式特殊规则（技能削弱）· 唯一数据来源', () => {
  it('规则调整：12 条、顺序与 id 精确', () => {
    expect(CHALLENGE_RULE_NOTES.map((n) => n.id)).toEqual([
      'leibao',
      'weimu',
      'shouhun',
      'shexie-gongzhen',
      'shexie-weiju',
      'kuangwu-ultimate',
      'aige-xianzhen',
      'hanguang-linglie',
      'tianfa-bairi',
      'tianfa-alt-shenkong',
      'diaoling-siwang',
      'xianji',
    ]);
    for (const n of CHALLENGE_RULE_NOTES) {
      expect(n.title.length).toBeGreaterThan(0);
      expect(n.text.length).toBeGreaterThan(0);
      expect(/^\d/.test(n.title)).toBe(false); // 标题**不带编号**
      expect(n.title).not.toContain('**'); // 不留 Markdown 强调标记
      expect(n.text).not.toContain('**');
    }
  });

  it('inertSkills：本模式下整条失效的技能 key 精确集合', () => {
    expect([...challengeInertSkills()].sort()).toEqual(
      ['minglei.leibao.continuous', 'tianfa.alt.shenkong', 'tianfa.bairi', 'youming.weimu'].sort(),
    );
  });
});
