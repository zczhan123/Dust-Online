import { describe, it, expect } from 'vitest';
import { SEAT_COLOR, TEAM_COLOR } from '../src/ui/seatColors';

describe('2v2 座位/队伍色板（旧 2v2）', () => {
  it('四人座位色精确匹配', () => {
    expect(SEAT_COLOR).toEqual({
      A1: '#2563eb',
      A2: '#38bdf8',
      B1: '#dc2626',
      B2: '#f472b6',
    });
  });

  it('队伍生命条色精确匹配', () => {
    expect(TEAM_COLOR).toEqual({ A: '#38bdf8', B: '#f472b6' });
  });
});
