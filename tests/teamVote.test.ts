import { describe, it, expect } from 'vitest';
import { castTeamVote, createTeamVote, teamVoteLabel } from '../src/core/engine/teamVote';

const options = [
  { id: 'B1', label: '玩家B1' },
  { id: 'B2', label: '玩家B2' },
];

describe('teamVote · 队内一致投票', () => {
  it('未集齐 → waiting；集齐且相同 → resolved', () => {
    const vote = createTeamVote('B', ['B1', 'B2'] as any, options);
    const first = castTeamVote(vote, 'B1' as any, 'B1');
    expect(first.outcome).toEqual({ status: 'waiting' });
    expect(first.vote.votes).toEqual({ B1: 'B1' });

    const second = castTeamVote(first.vote, 'B2' as any, 'B1');
    expect(second.outcome).toEqual({ status: 'resolved', choice: 'B1' });
    expect(second.vote.votes).toEqual({ B1: 'B1', B2: 'B1' });
    expect(teamVoteLabel(second.vote, 'B1')).toBe('玩家B1');
  });

  it('集齐但不同 → mismatch，并清空重投', () => {
    const vote = createTeamVote('B', ['B1', 'B2'] as any, options);
    const first = castTeamVote(vote, 'B1' as any, 'B1');
    const second = castTeamVote(first.vote, 'B2' as any, 'B2');
    expect(second.outcome).toEqual({ status: 'mismatch' });
    expect(second.vote.votes).toEqual({});
  });

  it('集齐前允许改票', () => {
    const vote = createTeamVote('B', ['B1', 'B2'] as any, options);
    const a = castTeamVote(vote, 'B1' as any, 'B1');
    const changed = castTeamVote(a.vote, 'B1' as any, 'B2');
    expect(changed.outcome).toEqual({ status: 'waiting' });
    const b = castTeamVote(changed.vote, 'B2' as any, 'B2');
    expect(b.outcome).toEqual({ status: 'resolved', choice: 'B2' });
  });

  it('单人投票立即生效', () => {
    const vote = createTeamVote('A', ['A1'] as any, options);
    expect(castTeamVote(vote, 'A1' as any, 'B1').outcome).toEqual({ status: 'resolved', choice: 'B1' });
  });

  it('非法投票人 / 非法选项 / 空配置抛错', () => {
    const vote = createTeamVote('B', ['B1', 'B2'] as any, options);
    expect(() => castTeamVote(vote, 'A1' as any, 'B1')).toThrow();
    expect(() => castTeamVote(vote, 'B1' as any, 'X')).toThrow();
    expect(() => createTeamVote('B', [], options)).toThrow();
    expect(() => createTeamVote('B', ['B1'] as any, [])).toThrow();
  });
});
