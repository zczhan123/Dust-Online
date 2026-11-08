import type { GameState, PlayerId } from '../model/types';
import { enemiesOf, membersOf, sideOf } from '../model/participants';

export interface TeamVoteOption {
  id: string;
  label: string;
}

/** 队内投票：所有投票人必须投给同一个选项；不一致则清空重投。 */
export interface TeamVoteState {
  team: string;
  voters: PlayerId[];
  options: TeamVoteOption[];
  votes: Record<string, string>;
}

export type TeamVoteOutcome =
  | { status: 'waiting' }
  | { status: 'resolved'; choice: string }
  | { status: 'mismatch' };

export function createTeamVote(
  team: string,
  voters: PlayerId[],
  options: TeamVoteOption[],
): TeamVoteState {
  if (voters.length === 0) throw new Error('team vote needs at least one voter');
  if (new Set(voters).size !== voters.length) throw new Error('duplicate team vote voter');
  if (options.length === 0) throw new Error('team vote needs at least one option');
  if (new Set(options.map((o) => o.id)).size !== options.length) {
    throw new Error('duplicate team vote option');
  }
  return { team, voters: [...voters], options: options.map((o) => ({ ...o })), votes: {} };
}

/**
 * 记一票并返回新状态与结果。
 * - 未集齐 → waiting
 * - 集齐且全部相同 → resolved
 * - 集齐但不同 → mismatch，并把票清空（调用方保留同一 pending 让双方重投）
 * 允许在集齐前改票（UI 正常流程会锁，但引擎不依赖 UI）。
 */
export function castTeamVote(
  vote: TeamVoteState,
  voter: PlayerId,
  choice: string,
): { vote: TeamVoteState; outcome: TeamVoteOutcome } {
  if (!vote.voters.includes(voter)) throw new Error(`not a team vote voter: ${voter}`);
  if (!vote.options.some((o) => o.id === choice)) throw new Error(`not a team vote option: ${choice}`);

  const votes = { ...vote.votes, [voter]: choice };
  const allVoted = vote.voters.every((v) => votes[v] != null);
  if (!allVoted) {
    return { vote: { ...vote, votes }, outcome: { status: 'waiting' } };
  }

  const chosen = new Set(vote.voters.map((v) => votes[v]));
  if (chosen.size === 1) {
    return { vote: { ...vote, votes }, outcome: { status: 'resolved', choice: [...chosen][0] } };
  }
  return { vote: { ...vote, votes: {} }, outcome: { status: 'mismatch' } };
}

/** 结果文案（战报/提示用）：优先返回选项 label。 */
export function teamVoteLabel(vote: TeamVoteState, choice: string): string {
  return vote.options.find((o) => o.id === choice)?.label ?? choice;
}

/** 2v2「守方选择」：由被打队伍的两名座位投票选出应对座位。 */
export function createDefenseVote(g: GameState, attacker: PlayerId): TeamVoteState {
  const candidates = enemiesOf(g, attacker);
  if (candidates.length === 0) throw new Error('no enemy candidates');
  const team = sideOf(g, candidates[0]);
  return createTeamVote(
    team,
    membersOf(g, team),
    candidates.map((id) => ({ id, label: id })),
  );
}
