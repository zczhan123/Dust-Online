import { describe, it, expect } from 'vitest';
import { applyAction, createGame, createTwoVTwoGame, getLegalActions, skipInitialReroll } from '../src/core/engine/game';
import { weijuAvailable } from '../src/core/engine/skills';
import { SKILL_SELECTION, type SelectStep } from '../src/ui/skillSelection';
import { toMain } from './helpers';
import type { GameState, PlayerId } from '../src/core/model/types';
import type { TwoVTwoSetup } from '../src/core/model/twoVTwo';

const art = (g: GameState, who: PlayerId, id: string) => g.players[who].artifacts.find((a) => a.id === id)!;

const game = (heroA: [string, string, string], heroB: [string, string, string], seed = 3): GameState => {
  const g = createGame({ seed, firstPlayer: 'A', heroA, heroB });
  skipInitialReroll(g);
  toMain(g);
  return g;
};

/** 把 034「金刚·破障」装到左侧（持续生效）并放上存放骰 */
const pozhangOn = (g: GameState, who: PlayerId, id: string, values: number[]): void => {
  const a = art(g, who, id);
  a.activeMarkerSide = 'left';
  a.heldDice = values.map((v, i) => ({ id: `${who}-${id}-j${i}-${v}-1`, value: v }));
};

/**
 * 034 / A03「金刚·破障」贯穿全游戏的兼容性。
 *
 * 规则：神器上存放的骰可以当能力骰**使用 / 消耗**（类型按持有者第二列分布推），
 * 但**不属于任何区域** → 弃置 / 移动 / 改点 / 重掷 / 计数一律不得用它。
 * 门禁点：`abilityDicePool`（含存放骰）、`findDieOf`（只认区域）、`paySlots`（两者都认）。
 */
describe('034 破障 × 035 超度：存放骰可作「消耗」（真实事故 B-034-j1-5-3）', () => {
  /** B 持 034（1 列）/ 035（2 列，分布里 5 点＝冥想）/ 027（3 列） */
  const setup = (held: number[] = [5]) => {
    const g = game(['001', '002', '003'], ['034', '035', '027']);
    g.activePlayer = 'B';
    g.phase = 'main';
    pozhangOn(g, 'B', '034', held);
    art(g, 'B', '035').activeMarkerSide = 'right'; // 超度
    g.players.A.areas = { attack: [], defense: [], meditation: [] };
    return g;
  };

  const chaodu = (g: GameState, slots: { dieIds: string[] }[]) =>
    applyAction(g, {
      t: 'skill',
      artifactId: '035',
      side: 'right',
      params: { costSlots: slots, targetOwner: 'opponent', targetKind: 'defense' },
    });

  it('1 颗存放骰（5 点）+ 1 颗真冥想骰（5 点）→ 正常发动，扣 2 格并打 5 点真伤', () => {
    const g = setup([5]);
    g.players.B.areas.meditation = [{ id: 'B-m5', value: 5, kind: 'meditation' }];
    const life = g.players.A.life;
    chaodu(g, [{ dieIds: ['B-034-j0-5-1'] }, { dieIds: ['B-m5'] }]);
    expect(g.players.B.areas.meditation).toEqual([]);
    expect(art(g, 'B', '034').heldDice).toEqual([]);
    expect(g.players.A.life).toBe(life - 5);
  });

  it('两颗都是存放骰（同点）→ 正常发动', () => {
    const g = setup([5, 5]);
    g.players.B.areas.meditation = [];
    const life = g.players.A.life;
    chaodu(g, [{ dieIds: ['B-034-j0-5-1'] }, { dieIds: ['B-034-j1-5-1'] }]);
    expect(art(g, 'B', '034').heldDice).toEqual([]);
    expect(g.players.A.life).toBe(life - 5);
  });

  it('两颗点数不同 → 抛错且不改状态', () => {
    const g = setup([5]);
    g.players.B.areas.meditation = [{ id: 'B-m3', value: 3, kind: 'meditation' }];
    expect(() =>
      chaodu(g, [{ dieIds: ['B-034-j0-5-1'] }, { dieIds: ['B-m3'] }]),
    ).toThrow('点数必须相同');
    expect(art(g, 'B', '034').heldDice?.length).toBe(1);
    expect(g.players.B.areas.meditation.length).toBe(1);
  });

  it('存放骰按第二列分布算出的类型不是冥想（3 点＝攻击）→ 抛「需消耗冥想骰」', () => {
    const g = setup([3]);
    g.players.B.areas.meditation = [{ id: 'B-m5', value: 5, kind: 'meditation' }];
    expect(() =>
      chaodu(g, [{ dieIds: ['B-034-j0-3-1'] }, { dieIds: ['B-m5'] }]),
    ).toThrow('需消耗冥想骰');
  });
});

describe('034 破障 × 023 畏惧：对方只有存放骰时仍可发动', () => {
  const setup = (held: number[] | null) => {
    // A 持 034（1 列）；B 持 023（2 列，畏惧在左）
    const g = game(['034', '002', '003'], ['004', '023', '009']);
    g.activePlayer = 'B';
    g.phase = 'main';
    if (held) pozhangOn(g, 'A', '034', held);
    g.players.A.areas = { attack: [], defense: [], meditation: [] };
    art(g, 'B', '023').activeMarkerSide = 'left';
    g.players.B.areas = {
      attack: [],
      defense: [],
      meditation: [{ id: 'B-m2', value: 2, kind: 'meditation' }],
    };
    return g;
  };

  it('对方区域骰为 0、但有存放骰 → weijuAvailable 为真，且能真的发动', () => {
    const g = setup([5]);
    expect(weijuAvailable(g, 'B')).toBe(true);
    applyAction(g, {
      t: 'skill',
      artifactId: '023',
      side: 'left',
      params: { costSlots: [{ dieIds: ['B-m2'] }] },
    });
    expect(g.pending?.kind).toBe('weijuPay'); // 对方（A）必须消耗 1 颗 → 由 A 决定
    expect(g.pending && 'player' in g.pending ? g.pending.player : null).toBe('A');
  });

  it('对方真的一颗都没有（连存放骰也没有）→ weijuAvailable 为假', () => {
    const g = setup(null);
    expect(weijuAvailable(g, 'B')).toBe(false);
    expect(() =>
      applyAction(g, {
        t: 'skill',
        artifactId: '023',
        side: 'left',
        params: { costSlots: [{ dieIds: ['B-m2'] }] },
      }),
    ).toThrow('对方没有能力骰');
  });
});

describe('034 破障 × 尘起：只有存放骰（可作冥想）时尘起入口仍出现', () => {
  it('区域骰全空 + 1 颗存放骰（5 点＝冥想）→ 有尘起动作，且能付成功', () => {
    // A 持 034（1 列）+ 035（2 列，5 点＝冥想）+ 003（3 列）
    const g = createGame({ seed: 7, firstPlayer: 'A', heroA: ['034', '035', '003'], heroB: ['001', '002', '009'] });
    skipInitialReroll(g);
    expect(g.phase).toBe('dustRise');
    pozhangOn(g, 'A', '034', [5]);
    g.players.A.areas = { attack: [], defense: [], meditation: [] };

    const dust = getLegalActions(g).filter((a) => a.t === 'dustRise');
    expect(dust.length).toBeGreaterThan(0);

    const act = dust.find((a) => a.t === 'dustRise' && a.artifactId === '035');
    expect(act).toBeTruthy();
    applyAction(g, act!);
    // 存放骰被消耗掉，035 的标记装到该侧
    expect(art(g, 'A', '034').heldDice).toEqual([]);
    expect(art(g, 'A', '035').activeMarkerSide).not.toBeNull();
  });

  it('034 未激活（无存放骰可用）→ 区域骰全空时没有尘起动作', () => {
    const g = createGame({ seed: 7, firstPlayer: 'A', heroA: ['034', '035', '003'], heroB: ['001', '002', '009'] });
    skipInitialReroll(g);
    const a = art(g, 'A', '034');
    a.activeMarkerSide = 'right'; // 破障（持续·左）不生效
    a.heldDice = [{ id: 'A-034-j0-5-1', value: 5 }];
    g.players.A.areas = { attack: [], defense: [], meditation: [] };
    const dust = getLegalActions(g).filter((x) => x.t === 'dustRise');
    expect(dust).toEqual([]);
  });
});

describe('023 畏惧 · 2v2：按"选中那一个敌人"看骰，不是只看第一个', () => {
  const setup = (b1Dice: boolean, b2Dice: boolean): GameState => {
    const cfg: TwoVTwoSetup = {
      seats: {
        A1: ['001', '023', '003'],
        A2: ['004', '005', '006'],
        B1: ['007', '008', '009'],
        B2: ['010', '011', '012'],
      },
      firstTeam: 'A',
      seed: 7,
    };
    const g = createTwoVTwoGame(cfg);
    art(g, 'A1', '023').activeMarkerSide = 'left'; // 畏惧
    g.players.A1.areas = {
      attack: [],
      defense: [],
      meditation: [{ id: 'A1-m2', value: 2, kind: 'meditation' }],
    };
    g.players.B1.areas = {
      attack: [],
      defense: [],
      meditation: b1Dice ? [{ id: 'B1-m2', value: 2, kind: 'meditation' }] : [],
    };
    g.players.B2.areas = {
      attack: [],
      defense: [],
      meditation: b2Dice ? [{ id: 'B2-m2', value: 2, kind: 'meditation' }] : [],
    };
    return g;
  };

  const seatCandidates = (g: GameState): PlayerId[] => {
    const steps = SKILL_SELECTION['shexie.weiju'].steps({
      state: g,
      player: 'A1',
      chosenDice: [],
      options: [],
      numbers: [],
      slots: [],
    } as never);
    const seat = steps[0] as Extract<SelectStep, { kind: 'seat' }>;
    expect(seat.kind).toBe('seat');
    return seat.candidates;
  };

  it('B1 无骰、B2 有骰 → 按钮在、候选只有 B2、可选 B2 发动', () => {
    const g = setup(false, true);
    expect(weijuAvailable(g, 'A1')).toBe(true);
    expect(
      getLegalActions(g).some((a) => a.t === 'skill' && a.artifactId === '023'),
    ).toBe(true);
    expect(seatCandidates(g)).toEqual(['B2']);
    applyAction(g, {
      t: 'skill',
      artifactId: '023',
      side: 'left',
      params: { dieId: 'A1-m2' },
      target: 'B2',
    });
    expect(g.pending?.kind).toBe('weijuPay');
    expect(g.pending && 'player' in g.pending ? g.pending.player : null).toBe('B2');
  });

  it('B1 有骰、B2 无骰 → 候选只有 B1', () => {
    const g = setup(true, false);
    expect(seatCandidates(g)).toEqual(['B1']);
  });

  it('两名敌人都没有骰 → 不生成「畏惧」动作', () => {
    const g = setup(false, false);
    expect(weijuAvailable(g, 'A1')).toBe(false);
    expect(
      getLegalActions(g).some((a) => a.t === 'skill' && a.artifactId === '023'),
    ).toBe(false);
  });
});
