import { describe, it, expect } from 'vitest';
import { createChallengeGame } from '../src/core/engine/game';
import { SKILL_HANDLERS } from '../src/core/engine/skills';
import { canPayCosts, paySlots } from '../src/core/engine/effects';
import { isValueLocked } from '../src/core/engine/challenge';
import { doReroll } from '../src/core/engine/phases';
import { SeededRng } from '../src/core/rng/rng';
import type { Die, DiceKind, GameState } from '../src/core/model/types';

const die = (id: string, value: number, kind: DiceKind = 'attack'): Die => ({ id, value, kind });
const make = (challenger: [string, string, string] = ['004', '005', '006']): GameState =>
  createChallengeGame({ seed: 1, cardId: 'Z12', challenger, settleMode: 'manual' });
const setA = (g: GameState, areas: { attack?: Die[]; defense?: Die[]; meditation?: Die[] }): void => {
  g.players.A.areas.attack = areas.attack ?? [];
  g.players.A.areas.defense = areas.defense ?? [];
  g.players.A.areas.meditation = areas.meditation ?? [];
};
const arm = (g: GameState, who: 'A', id: string, side: 'left' | 'right'): void => {
  const a = g.players[who].artifacts.find((x) => x.id === id)!;
  a.activeMarkerSide = side;
  a.armedSide = side;
  a.armedTurn = g.turnIndex;
};
const runSkill = (
  g: GameState,
  who: 'A',
  id: string,
  key: string,
  params: Record<string, unknown> = {},
): void => {
  const artifact = g.players[who].artifacts.find((x) => x.id === id)!;
  SKILL_HANDLERS[key].run({
    g,
    player: who,
    artifact,
    rng: new SeededRng(1),
    params,
    endMainPhase: () => {},
    reportConsumed: () => {},
  });
};

describe('Z12 不动菩提 · 非使用操作之后，使用/消耗/弃置锁仍然生效', () => {
  it('005 影袭：锁 3 点 → 3 降为 2 后可用；4 降为 3 后仍不可用', () => {
    const g = make();
    g.challenge!.lockValue = 3;
    setA(g, { attack: [die('d3', 3)] });
    runSkill(g, 'A', '005', 'yingle.yingxi', { dieId: 'd3', x: 1 });
    expect(g.players.A.areas.attack.find((d) => d.id === 'd3')?.value).toBe(2);
    expect(() => paySlots(g, 'A', [{ kind: 'attack' }], [{ dieIds: ['d3'] }])).not.toThrow();

    const g2 = make();
    g2.challenge!.lockValue = 3;
    setA(g2, { attack: [die('d4', 4)] });
    runSkill(g2, 'A', '005', 'yingle.yingxi', { dieId: 'd4', x: 1 });
    const after4 = [...g2.players.A.areas.attack, ...g2.players.A.areas.defense, ...g2.players.A.areas.meditation].find(
      (d) => d.id === 'd4',
    );
    expect(after4?.value).toBe(3);
    expect(() => paySlots(g2, 'A', [{ kind: 'attack' }], [{ dieIds: ['d4'] }])).toThrow();
  });

  it('012/013/024/L06/029 的“移动/分配”之后：锁点骰仍不能用于攻击', () => {
    const g = make();
    g.challenge!.lockValue = 3;
    setA(g, { meditation: [die('m3', 3, 'meditation')] });
    // 模拟这些技能的移动结果（引擎里是 moveDice/transferDice，骰子 id 与点数不变）
    g.players.A.areas.meditation = [];
    g.players.A.areas.attack = [die('m3', 3, 'attack')];
    expect(isValueLocked(g, 'A', 3)).toBe(true);
    expect(() => paySlots(g, 'A', [{ kind: 'attack' }], [{ dieIds: ['m3'] }])).toThrow();
  });

  it('023 共振：重掷锁点骰本身允许；重掷后若仍是锁点，仍不可用', () => {
    const g = make();
    g.challenge!.lockValue = 3;
    setA(g, { attack: [die('r3', 3)] });
    expect(() => doReroll(g, 'A', ['r3'], new SeededRng(1))).not.toThrow();
    // 无论重掷结果，锁只按“点数”判定；若结果仍是 3，则使用仍被拒
    const after = g.players.A.areas.attack.find((d) => d.id === 'r3');
    if (after?.value === 3) {
      expect(() => paySlots(g, 'A', [{ kind: 'attack' }], [{ dieIds: ['r3'] }])).toThrow();
    }
  });

  it('026 威压/014 改点：把骰改成锁点后，使用仍被拒', () => {
    const g = make();
    g.challenge!.lockValue = 4;
    setA(g, { attack: [die('c3', 3)] });
    g.players.A.areas.attack[0].value = 4; // 模拟“改为 4 点”
    expect(() => paySlots(g, 'A', [{ kind: 'attack' }], [{ dieIds: ['c3'] }])).toThrow();
  });

  it('010 真实之剑：锁 5 时置换不可用；锁 3 时 3 点可作源骰（有效 5 未被锁）', () => {
    const g = make(['010', '002', '003']);
    arm(g, 'A', '010', 'left');
    g.challenge!.lockValue = 5;
    setA(g, { meditation: [die('s3a', 3, 'meditation'), die('s3b', 3, 'meditation')] });
    expect(canPayCosts(g, 'A', { attack: 1 }, { held: true })).toBe(false);

    g.challenge!.lockValue = 3;
    expect(canPayCosts(g, 'A', { attack: 1 }, { held: true })).toBe(true);
  });
});
