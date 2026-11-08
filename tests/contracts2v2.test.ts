import { describe, it, expect } from 'vitest';
import { createGame } from '../src/core/engine/game';
import { battleNotes } from '../src/core/engine/battleNotes';
import { pumpPending, queuePending } from '../src/core/engine/pending';
import { defenderOf } from '../src/core/engine/combat';
import { SKILL_SELECTION, type SkillSelection } from '../src/ui/skillSelection';
import type { PendingAttack } from '../src/core/model/types';
import { toMain } from './helpers';

describe('2v2 共享契约', () => {
  it('battleNotes 接受目标参数；1v1 下与默认一致', () => {
    const g = createGame({ seed: 2, firstPlayer: 'A' });
    toMain(g);
    expect(battleNotes(g, 'A', 'B')).toEqual(battleNotes(g, 'A'));
  });

  it('Pending 公共归属字段可携带 cardOwner', () => {
    const g = createGame({ seed: 2, firstPlayer: 'A' });
    g.pending = null;
    g.pendingQueue = [];
    queuePending(g, { kind: 'weimu', player: 'A', owner: 'B', cardOwner: 'A' });
    pumpPending(g);
    const pending = g.pending as { kind?: string; cardOwner?: string } | null;
    expect(pending?.kind).toBe('weimu');
    expect(pending?.cardOwner).toBe('A');
  });

  it('SelectStep 支持 seat 步与 target 参数', () => {
    const spec: SkillSelection = {
      steps: () => [{ kind: 'seat', label: '选择目标', candidates: ['B'] }],
      buildParams: ({ target }) => ({ target }),
    };
    const g = createGame({ seed: 2, firstPlayer: 'A' });
    const args = {
      state: g,
      player: 'A' as const,
      chosenDice: [],
      options: [],
      numbers: [],
      slots: [],
      target: 'B' as const,
    };
    expect(spec.steps(args)).toEqual([{ kind: 'seat', label: '选择目标', candidates: ['B'] }]);
    expect(spec.buildParams(args)).toEqual({ target: 'B' });
  });

  it('PendingAttack 可显式防守座位；1v1 缺省仍解析为唯一敌人', () => {
    const g = createGame({ seed: 2, firstPlayer: 'A' });
    const pa = { attacker: 'A', value: 1, unblockable: false, physical: true } as PendingAttack;
    expect(defenderOf(g, pa)).toBe('B');
    expect(defenderOf(g, { ...pa, defender: 'B' })).toBe('B');

    g.roster = ['A1', 'B1', 'A2', 'B2'];
    g.teamOf = { A1: 'A', A2: 'A', B1: 'B', B2: 'B' };
    const pa2 = { ...pa, attacker: 'A1', defender: 'B2' } as PendingAttack;
    expect(defenderOf(g, pa2)).toBe('B2');
    expect(() => defenderOf(g, { ...pa, attacker: 'A1' })).toThrow();
  });

  it('1v1 的 003/007 选择器不返回 seat 步（2v2 才返回）', () => {
    const g = createGame({ seed: 2, firstPlayer: 'A' });
    for (const key of ['mingjing.ultimate', 'zhuzai.sweep', 'zhuzai.smash']) {
      const steps = SKILL_SELECTION[key].steps({
        state: g,
        player: 'A',
        chosenDice: [],
        options: [],
        numbers: [],
        slots: [],
      });
      expect(steps.some((s) => s.kind === 'seat')).toBe(false);
    }
  });
});
