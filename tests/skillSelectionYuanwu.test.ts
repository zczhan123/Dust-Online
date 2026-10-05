import { describe, it, expect } from 'vitest';
import { createGame } from '../src/core/engine/game';
import { SKILL_SELECTION } from '../src/ui/skillSelection';
import type { GameState } from '../src/core/model/types';

/** 取圆舞选择器第二步（"移动到哪个区域"）的选项 value 列表 */
function yuanwuOptions(g: GameState, chosenDice: string[][]): string[] {
  const spec = SKILL_SELECTION['@yuanwu'];
  const steps = spec.steps({ state: g, player: 'A', chosenDice, options: [], numbers: [], slots: [] });
  const step = steps[1];
  if (step.kind !== 'option') throw new Error('expected option step');
  return step.options.map((o) => o.value);
}

const mk = (): GameState =>
  createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] });

describe('圆舞选择器 · 第二步排除骰子所在的区（防"移到原区"非法确认）', () => {
  it('选冥想骰 → 只剩 攻击/防御', () => {
    const g = mk();
    g.players.A.areas.meditation = [{ id: 'm1', value: 5, kind: 'meditation' }];
    expect(yuanwuOptions(g, [['m1']])).toEqual(['attack', 'defense']);
  });

  it('选攻击骰 → 只剩 防御/冥想', () => {
    const g = mk();
    g.players.A.areas.attack = [{ id: 'a1', value: 5, kind: 'attack' }];
    expect(yuanwuOptions(g, [['a1']])).toEqual(['defense', 'meditation']);
  });

  it('选防御骰 → 只剩 攻击/冥想', () => {
    const g = mk();
    g.players.A.areas.defense = [{ id: 'd1', value: 5, kind: 'defense' }];
    expect(yuanwuOptions(g, [['d1']])).toEqual(['attack', 'meditation']);
  });

  it('还没选骰 → 三个区都在（占位）', () => {
    const g = mk();
    expect(yuanwuOptions(g, [[]])).toEqual(['attack', 'defense', 'meditation']);
  });
});
