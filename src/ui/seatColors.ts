import type { TwoVTwoSeat, TwoVTwoTeam } from '../core/model/twoVTwo';

/** 2v2 座位身份色：A 队蓝系、B 队红/橙系；B1 与 B2 用色相+明度拉开。 */
export const SEAT_COLOR: Record<TwoVTwoSeat, string> = {
  A1: '#2563eb',
  A2: '#38bdf8',
  B1: '#dc2626',
  B2: '#f472b6',
};

/** 骰子/文字在座位色上的对比色。 */
export const SEAT_INK: Record<TwoVTwoSeat, string> = {
  A1: '#ffffff',
  A2: '#ffffff',
  B1: '#ffffff',
  B2: '#ffffff',
};

/** 队伍身份色（生命条、队伍徽标）。 */
export const TEAM_COLOR: Record<TwoVTwoTeam, string> = {
  A: '#38bdf8',
  B: '#f472b6',
};
