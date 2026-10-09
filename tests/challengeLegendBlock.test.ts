import { describe, it, expect } from 'vitest';
import { createChallengeGame, getLegalActions } from '../src/core/engine/game';
import type { Die } from '../src/core/model/types';

const make = (cardId = 'Z02') =>
  createChallengeGame({ seed: 1, cardId, challenger: ['001', '002', '003'] });

const defDie = (id: string, value: number): Die => ({ id, value, kind: 'defense' });

/** 挑战者(A) 攻击 传奇(B)：直接造一个待抵挡窗口（不经过完整攻击流程）。 */
function attackLegend(g: ReturnType<typeof make>, value: number, unblockable = false): void {
  g.phase = 'main'; // 让 getLegalActions 走到"待抵挡"分支（否则停在 initialReroll）
  g.pendingAttack = { attacker: 'A', value, unblockable, physical: true, baseValue: value };
}

const bareDeclines = (g: ReturnType<typeof make>) =>
  getLegalActions(g).filter((a) => a.t === 'block' && !(a.costSlots?.length));
const dieBlocks = (g: ReturnType<typeof make>) =>
  getLegalActions(g).filter((a) => a.t === 'block' && a.costSlots?.length);

describe('挑战模式 · 传奇「防御规则」：伤害 ≥ 门槛必须挡（不给"不抵御"）', () => {
  it('Z02 门槛 3：伤害 5 + 传奇有 2 颗防御骰 → 无"不抵御"，只有 2 个选骰抵挡', () => {
    const g = make('Z02');
    g.players.B.areas.defense = [defDie('b1', 1), defDie('b2', 6)];
    attackLegend(g, 5);
    expect(bareDeclines(g)).toHaveLength(0);
    expect(dieBlocks(g)).toHaveLength(2);
  });

  it('Z02 门槛 3：伤害 2（< 门槛）→ 传奇自动不挡：只有"不抵御"，无选骰抵挡', () => {
    const g = make('Z02');
    g.players.B.areas.defense = [defDie('b1', 1), defDie('b2', 6)];
    attackLegend(g, 2);
    expect(bareDeclines(g)).toHaveLength(1);
    expect(dieBlocks(g)).toHaveLength(0);
  });

  it('Z02 门槛 3：伤害 5 但传奇无防御骰 → 退化为"不抵御"（无骰可挡）', () => {
    const g = make('Z02');
    g.players.B.areas.defense = [];
    attackLegend(g, 5);
    expect(bareDeclines(g)).toHaveLength(1);
    expect(dieBlocks(g)).toHaveLength(0);
  });

  it('Z02：不可抵挡攻击（暗夜凶神）→ 只有"不抵御"，无选骰抵挡', () => {
    const g = make('Z02');
    g.players.B.areas.defense = [defDie('b1', 1)];
    attackLegend(g, 5, true);
    expect(bareDeclines(g)).toHaveLength(1);
    expect(dieBlocks(g)).toHaveLength(0);
  });

  it('Z01 门槛 2：伤害 2 也必须挡（门槛按卡走）', () => {
    const g = make('Z01');
    g.players.B.areas.defense = [defDie('b1', 3)];
    attackLegend(g, 2);
    expect(bareDeclines(g)).toHaveLength(0);
    expect(dieBlocks(g)).toHaveLength(1);
  });
});
