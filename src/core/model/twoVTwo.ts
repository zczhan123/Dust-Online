export type TwoVTwoSeat = 'A1' | 'A2' | 'B1' | 'B2';
export type TwoVTwoTeam = 'A' | 'B';

export interface TwoVTwoDice {
  attack: number[];
  defense: number[];
  meditation: number[];
}

export interface TwoVTwoSetup {
  /** 每个座位的三件神器，按第一列 / 第二列 / 第三列排列 */
  seats: Record<TwoVTwoSeat, [string, string, string]>;
  /** 先手队伍；决定战斗起始队伍 */
  firstTeam: TwoVTwoTeam;
  /** 初始骰池；真实对局可由引擎投掷，测试可直接给值 */
  dice?: Partial<Record<TwoVTwoSeat, TwoVTwoDice>>;
  /** 抽骰/重掷的确定性种子；缺省 1 */
  seed?: number;
  /** 真实对局：建局后从 initialReroll 开始；预览/测试不传则直接 main */
  startPhase?: boolean;
  /** 测试/续局用：指定席位神器的初始激活面 */
  active?: Partial<Record<TwoVTwoSeat, Record<string, 'left' | 'right'>>>;
  /** 测试/续局用：指定席位神器的初始计数 */
  counts?: Partial<Record<TwoVTwoSeat, Record<string, number>>>;
}
