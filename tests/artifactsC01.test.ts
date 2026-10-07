import { describe, it, expect } from 'vitest';
import { createGame, applyAction, skipInitialReroll, getLegalActions } from '../src/core/engine/game';
import { virtualAttack } from '../src/core/engine/combat';
import { battleNotes } from '../src/core/engine/battleNotes';
import { ARTIFACTS, ALT_OF, BASE_OF } from '../src/core/content/artifacts';
import type { Die, GameState, PlayerId } from '../src/core/model/types';

/**
 * C01「雨切」（特典版，替换标准 001）：
 * 左 `c01.breakthrough`（启动·突破）：消耗任意数量冥想骰（≥1）→ 弃置对方等量防御骰（发起者选；无「不可抵挡」）。
 * 右 `c01.caiyuliu`（触发·极之境·裁雨流）：使用攻击骰造成伤害后，可重掷该骰并按新点数用第二列分布落区（无次数上限）。
 * A 持 C01/002/003（C01 第一列；002 第二列提供分布 防{1,6} 攻{3,4} 冥{2,5}），B 持 004/005/006。
 */
const mk = (): GameState => {
  const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['C01', '002', '003'], heroB: ['004', '005', '006'] });
  skipInitialReroll(g);
  return g;
};
const art = (g: GameState, who: PlayerId, id: string) => g.players[who].artifacts.find((a) => a.id === id)!;
const toMain = (g: GameState): void => {
  let guard = 0;
  while (g.phase !== 'main' && g.phase !== 'gameOver' && guard++ < 12) applyAction(g, { t: 'advance' });
};
const clear = (g: GameState, who: PlayerId): void => {
  g.players[who].areas.attack = [];
  g.players[who].areas.defense = [];
  g.players[who].areas.meditation = [];
};
const arm = (g: GameState, who: PlayerId, id: string, side: 'left' | 'right'): void => {
  const a = art(g, who, id);
  a.activeMarkerSide = side;
  a.armedSide = side;
  a.armedTurn = g.turnIndex;
};
const allDice = (g: GameState, who: PlayerId): Die[] => [
  ...g.players[who].areas.attack,
  ...g.players[who].areas.defense,
  ...g.players[who].areas.meditation,
];

describe('C01 雨切（特典）·内容数据守卫', () => {
  it('字段与 skills 精确登记；special 标记；ALT_OF/BASE_OF 映射', () => {
    const a = ARTIFACTS['C01'];
    expect(a.id).toBe('C01');
    expect(a.name).toBe('雨切');
    expect(a.weapon).toBe('武士刀');
    expect(a.column).toBe(1);
    expect(a.speed).toBe(4);
    expect(a.will).toBe(7);
    expect(a.special).toBe(true);
    expect(a.skills).toEqual([
      { side: 'left', kind: 'activate', key: 'c01.breakthrough' },
      { side: 'right', kind: 'trigger', key: 'c01.caiyuliu' },
    ]);
    expect(ALT_OF['001']).toBe('C01');
    expect(BASE_OF['C01']).toBe('001');
  });
});

describe('C01 突破（启动）：消耗任意数量冥想骰 → 弃对方等量防御骰', () => {
  it('消耗 3 颗冥想骰 → 弃对方全部 2 颗防御骰；不设置「不可抵挡」', () => {
    const g = mk();
    toMain(g);
    arm(g, 'A', 'C01', 'left');
    clear(g, 'A');
    clear(g, 'B');
    g.players.A.areas.meditation = [
      { id: 'am1', value: 1, kind: 'meditation' },
      { id: 'am2', value: 3, kind: 'meditation' },
      { id: 'am3', value: 5, kind: 'meditation' },
    ];
    g.players.B.areas.defense = [
      { id: 'bd1', value: 2, kind: 'defense' },
      { id: 'bd2', value: 6, kind: 'defense' },
    ];
    expect(g.unblockableThisTurn).toBe(false);

    applyAction(g, {
      t: 'skill',
      artifactId: 'C01',
      side: 'left',
      params: {
        costSlots: [{ dieIds: ['am1'] }, { dieIds: ['am2'] }, { dieIds: ['am3'] }],
        opponentDefenseDieIds: ['bd2', 'bd1'],
      },
    });

    expect(g.players.A.areas.meditation).toEqual([]);
    expect(g.players.B.areas.defense).toEqual([]);
    expect(g.unblockableThisTurn).toBe(false);
  });

  it('按所选 id 弃置：消耗 1 只弃指定的 bd2，bd1 保留', () => {
    const g = mk();
    toMain(g);
    arm(g, 'A', 'C01', 'left');
    clear(g, 'A');
    clear(g, 'B');
    g.players.A.areas.meditation = [{ id: 'am1', value: 4, kind: 'meditation' }];
    g.players.B.areas.defense = [
      { id: 'bd1', value: 5, kind: 'defense' },
      { id: 'bd2', value: 6, kind: 'defense' },
    ];

    applyAction(g, {
      t: 'skill',
      artifactId: 'C01',
      side: 'left',
      params: { costSlots: [{ dieIds: ['am1'] }], opponentDefenseDieIds: ['bd2'] },
    });

    expect(g.players.A.areas.meditation).toEqual([]);
    expect(g.players.B.areas.defense).toEqual([{ id: 'bd1', value: 5, kind: 'defense' }]);
    expect(g.unblockableThisTurn).toBe(false);
  });

  it('对方防御不足时尽全力：消耗 3 颗冥想骰、B 仅 1 颗防御 → 只弃 1 颗', () => {
    const g = mk();
    toMain(g);
    arm(g, 'A', 'C01', 'left');
    clear(g, 'A');
    clear(g, 'B');
    g.players.A.areas.meditation = [
      { id: 'am1', value: 1, kind: 'meditation' },
      { id: 'am2', value: 2, kind: 'meditation' },
      { id: 'am3', value: 3, kind: 'meditation' },
    ];
    g.players.B.areas.defense = [{ id: 'bd1', value: 2, kind: 'defense' }];

    applyAction(g, {
      t: 'skill',
      artifactId: 'C01',
      side: 'left',
      params: {
        costSlots: [{ dieIds: ['am1'] }, { dieIds: ['am2'] }, { dieIds: ['am3'] }],
        opponentDefenseDieIds: ['bd1'],
      },
    });

    expect(g.players.A.areas.meditation).toEqual([]);
    expect(g.players.B.areas.defense).toEqual([]);
    expect(g.unblockableThisTurn).toBe(false);
  });

  it('不足 1 颗冥想骰 → 无法发动（getLegalActions 不含突破）', () => {
    const g = mk();
    toMain(g);
    arm(g, 'A', 'C01', 'left');
    clear(g, 'A');
    clear(g, 'B');
    expect(getLegalActions(g).some((a) => a.t === 'skill' && a.artifactId === 'C01' && a.side === 'left')).toBe(false);
  });
});

describe('C01 极之境·裁雨流（触发）：造成伤害后重掷该攻击骰并按第二列分布落区', () => {
  /** 构造：C01 右侧激活、A 攻击骰 atk、B 无防御；返回 [g, atk] */
  const attackSetup = (atkValue: number): { g: GameState } => {
    const g = mk();
    toMain(g);
    arm(g, 'A', 'C01', 'right');
    clear(g, 'A');
    clear(g, 'B');
    g.players.A.areas.attack = [{ id: 'atk', value: atkValue, kind: 'attack' }];
    return { g };
  };

  it('造成伤害 → 弹出 c01Caiyuliu；accept 后**重掷该攻击骰（复用其 id）**并按 002 分布落区（固定 seed）', () => {
    const { g } = attackSetup(4);
    const before = new Set(allDice(g, 'A').map((d) => d.id));

    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['atk'] }] });
    expect(g.pendingAttack?.value).toBe(4);
    applyAction(g, { t: 'block' });
    expect(g.pending?.kind).toBe('c01Caiyuliu');
    expect(g.pending && g.pending.kind === 'c01Caiyuliu' ? g.pending.player : null).toBe('A');

    expect(getLegalActions(g)).toEqual([
      { t: 'c01Caiyuliu', accept: true },
      { t: 'c01Caiyuliu', accept: false },
    ]);

    applyAction(g, { t: 'c01Caiyuliu', accept: true });
    expect(g.pending).toBeNull();

    // 复用**攻击骰 id**（'atk'）——不再是"新增一颗"（界面才能"中间重掷翻面 → 飞回区域"）
    expect(allDice(g, 'A')).toHaveLength(before.size); // 攻击骰被回收，总数回到开打前
    // seed=1 固定：重掷结果为 1 点；002 分布 防{1,6} 攻{3,4} 冥{2,5} → 落到防御区
    expect(g.players.A.areas.defense).toEqual([{ id: 'atk', value: 1, kind: 'defense' }]);
  });

  it('decline → 不新增骰子，战报写「放弃」', () => {
    const { g } = attackSetup(4);
    const before = new Set(allDice(g, 'A').map((d) => d.id));

    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['atk'] }] });
    applyAction(g, { t: 'block' });
    expect(g.pending?.kind).toBe('c01Caiyuliu');

    applyAction(g, { t: 'c01Caiyuliu', accept: false });
    expect(g.pending).toBeNull();
    expect(allDice(g, 'A').filter((d) => !before.has(d.id))).toEqual([]);
    expect(g.log[g.log.length - 1]?.text).toContain('放弃「极之境·裁雨流」');
  });

  it('边界：被抵挡（0 伤害）→ 不触发', () => {
    const { g } = attackSetup(4);
    g.players.B.areas.defense = [{ id: 'bd', value: 2, kind: 'defense' }];

    applyAction(g, { t: 'attack', costSlots: [{ dieIds: ['atk'] }] });
    applyAction(g, { t: 'block', costSlots: [{ dieIds: ['bd'] }] });
    expect(g.pending?.kind ?? null).not.toBe('c01Caiyuliu');
    expect(g.pending ?? null).toBeNull();
  });

  it('边界：虚拟攻击（physical=false）→ 不触发', () => {
    const { g } = attackSetup(4);
    g.players.A.areas.attack = [];

    virtualAttack(g, 'A', 3);
    expect(g.pendingAttack?.physical).toBe(false);
    applyAction(g, { t: 'block' });
    expect(g.pending?.kind ?? null).not.toBe('c01Caiyuliu');
    expect(g.pending ?? null).toBeNull();
  });
});

describe('C01 战斗提示：主阶段攻击修正登记', () => {
  it('C01 激活右 → 出现「裁雨流」提示；「突破 / 极之境」不出现', () => {
    const g = mk();
    toMain(g);
    arm(g, 'A', 'C01', 'right');
    const joined = battleNotes(g, 'A')
      .map((n) => `${n.label}${n.text}`)
      .join('｜');
    expect(joined).toContain('裁雨流');
    expect(joined).not.toContain('突破');
    expect(joined).not.toContain('极之境');
  });
});
