import type { Artifact } from '../model/types';

type ArtifactBase = Omit<
  Artifact,
  'activeMarkerSide' | 'armedSide' | 'armedTurn' | 'count' | 'chargeLayer'
>;

export const ARTIFACTS: Record<string, ArtifactBase> = {
  '001': { id: '001', name: '雨切', weapon: '武士刀', column: 1, speed: 4, will: 7, skills: [{ side: 'left', kind: 'activate', key: 'yuqie.breakthrough' }, { side: 'right', kind: 'trigger', key: 'yuqie.caiyuliu' }] },
  '002': { id: '002', name: '游龙', weapon: '刀鞘', column: 2, distribution: { defense: [1, 6], attack: [3, 4], meditation: [2, 5] }, skills: [{ side: 'left', kind: 'continuous', key: 'youlong.wanxiang' }, { side: 'right', kind: 'activate', key: 'youlong.tengwan' }] },
  '003': { id: '003', name: '明镜', weapon: '玉佩', column: 3, life: 50, chargeReq: 4, skills: [{ side: 'only', kind: 'charge', key: 'mingjing.charge' }, { side: 'only', kind: 'ultimate', key: 'mingjing.ultimate' }] },
  '004': { id: '004', name: '不祥', weapon: '双刀', column: 1, speed: 4, will: 8, countCap: 3, skills: [{ side: 'left', kind: 'activate', key: 'buxiang.cuilian' }, { side: 'right', kind: 'continuous', key: 'buxiang.fengmang' }, { side: 'right', kind: 'trigger', key: 'buxiang.fengmang.trigger' }] },
  '005': { id: '005', name: '影掠', weapon: '飞刀', column: 2, distribution: { defense: [3], attack: [1, 2, 6], meditation: [4, 5] }, skills: [{ side: 'left', kind: 'activate', key: 'yingle.yingxi' }, { side: 'right', kind: 'activate', key: 'yingle.qianxing' }] },
  '006': { id: '006', name: '完杀', weapon: '戒指', column: 3, life: 50, chargeReq: 4, skills: [{ side: 'only', kind: 'charge', key: 'wansha.charge' }, { side: 'only', kind: 'ultimate', key: 'wansha.ultimate' }] },
  '007': { id: '007', name: '主宰', weapon: '长戟', column: 1, speed: 4, will: 7, skills: [
    { side: 'left', kind: 'activate', key: 'zhuzai.sweep' },
    { side: 'right', kind: 'activate', key: 'zhuzai.smash' },
  ] },
  '008': { id: '008', name: '铁壁', weapon: '塔盾', column: 2, distribution: { defense: [1, 6], attack: [2, 5], meditation: [3, 4] }, skills: [
    { side: 'left', kind: 'continuous', key: 'tiebi.chariot' },
    { side: 'right', kind: 'activate', key: 'tiebi.fist' },
  ] },
  '009': { id: '009', name: '孤王', weapon: '王冠', column: 3, life: 50, chargeReq: 3, skills: [
    { side: 'only', kind: 'charge', key: 'guwang.charge' },
    { side: 'only', kind: 'trigger', key: 'guwang.trigger' },
    { side: 'only', kind: 'ultimate', key: 'guwang.ultimate' },
  ] },
  '010': { id: '010', name: '深红', weapon: '刺剑', column: 1, speed: 4, will: 8, skills: [
    { side: 'left', kind: 'continuous', key: 'shenhong.sword' },
    { side: 'right', kind: 'trigger', key: 'shenhong.kill' },
  ] },
  '011': { id: '011', name: '顿悟', weapon: '法衣', column: 2, distribution: { defense: [1, 6], attack: [2, 4], meditation: [3, 5] }, skills: [
    { side: 'left', kind: 'activate', key: 'dunwu.barrier.activate' },
    { side: 'left', kind: 'trigger', key: 'dunwu.barrier.trigger' },
    { side: 'right', kind: 'activate', key: 'dunwu.pulse.activate' },
    { side: 'right', kind: 'trigger', key: 'dunwu.pulse.trigger' },
  ] },
  '012': { id: '012', name: '魔女', weapon: '时计', column: 3, life: 40, chargeReq: 1, skills: [
    { side: 'only', kind: 'continuous', key: 'monv.awaken' },
    { side: 'only', kind: 'ultimate', key: 'monv.ultimate' },
  ] },
  '013': {
    id: '013',
    name: '鸣雷',
    weapon: '长枪',
    column: 1,
    speed: 3,
    will: 9,
    skills: [
      { side: 'left', kind: 'trigger', key: 'minglei.dianxing' },
      { side: 'right', kind: 'trigger', key: 'minglei.leibao.trigger' },
      { side: 'right', kind: 'continuous', key: 'minglei.leibao.continuous' },
    ],
  },
  '014': {
    id: '014',
    name: '惩戒',
    weapon: '手甲',
    column: 2,
    distribution: { defense: [1, 4], attack: [2, 6], meditation: [3, 5] },
    skills: [
      { side: 'left', kind: 'activation', key: 'chengjie.jinghua' },
      { side: 'right', kind: 'activation', key: 'chengjie.shuzui' },
    ],
  },
  '015': {
    id: '015',
    name: '残响',
    weapon: '项链',
    column: 3,
    life: 50,
    chargeReq: 2,
    countCap: 4,
    skills: [
      { side: 'only', kind: 'continuous', key: 'canxiang.juejing' },
      { side: 'only', kind: 'ultimate', key: 'canxiang.juejing.ultimate' },
    ],
  },
  '016': {
    id: '016',
    name: '虚臾',
    weapon: '镰刀',
    column: 1,
    speed: 3,
    will: 8,
    skills: [
      { side: 'left', kind: 'activation', key: 'xuyu.void' },
      { side: 'left', kind: 'continuous', key: 'xuyu.void.continuous' },
      { side: 'right', kind: 'activate', key: 'xuyu.sacrifice' },
    ],
  },
  '017': {
    id: '017',
    name: '幽冥',
    weapon: '书',
    column: 2,
    distribution: { defense: [3, 4], attack: [1, 6], meditation: [2, 5] },
    skills: [
      { side: 'left', kind: 'trigger', key: 'youming.weimu' },
      { side: 'right', kind: 'activate', key: 'youming.mingjie' },
      { side: 'right', kind: 'continuous', key: 'youming.mingjie.continuous' },
    ],
  },
  '018': {
    id: '018',
    name: '至黑',
    weapon: '钥匙',
    column: 3,
    life: 45,
    chargeReq: 1,
    countCap: 5,
    skills: [
      { side: 'only', kind: 'continuous', key: 'zhihai.bloom' },
      { side: 'only', kind: 'ultimate', key: 'zhihai.bloom.ultimate' },
    ],
  },
  '019': {
    id: '019',
    name: '尘哀',
    weapon: '斧',
    column: 1,
    speed: 4,
    will: 7,
    skills: [
      { side: 'left', kind: 'trigger', key: 'chenai.rise' },
      { side: 'right', kind: 'activate', key: 'chenai.fang', refresh: true },
    ],
  },
  '020': {
    id: '020',
    name: '兽魂',
    weapon: '爪',
    column: 2,
    distribution: { defense: [1, 6], attack: [3, 5], meditation: [2, 4] },
    countCap: 2,
    skills: [
      { side: 'left', kind: 'activation', key: 'shouhun.xiong' },
      { side: 'left', kind: 'continuous', key: 'shouhun.xiong.continuous' },
      { side: 'right', kind: 'activation', key: 'shouhun.lang' },
      { side: 'right', kind: 'continuous', key: 'shouhun.lang.continuous' },
    ],
  },
  '021': {
    id: '021',
    name: '决意',
    weapon: '护符',
    column: 3,
    life: 50,
    chargeReq: 1,
    chargeExtend: true,
    countCap: 5,
    skills: [
      { side: 'only', kind: 'activation', key: 'jueyi.wildfire' },
      { side: 'only', kind: 'continuous', key: 'jueyi.wildfire.continuous' },
    ],
  },
  '022': {
    id: '022',
    name: '死契',
    weapon: '火绳铳',
    column: 1,
    speed: 4,
    will: 8,
    countCap: 6,
    skills: [
      { side: 'left', kind: 'activate', key: 'siji.tiandan' },
      { side: 'right', kind: 'trigger', key: 'siji.chuxing' },
    ],
  },
  '023': {
    id: '023',
    name: '蛇蝎',
    weapon: '面具',
    column: 2,
    distribution: { attack: [2, 5], defense: [1, 6], meditation: [3, 4] },
    skills: [
      { side: 'left', kind: 'activate', key: 'shexie.weiju' },
      { side: 'right', kind: 'activate', key: 'shexie.gongzhen' },
    ],
  },
  '024': {
    id: '024',
    name: '狂舞',
    weapon: '燧发枪',
    column: 3,
    life: 50,
    chargeReq: 4,
    skills: [
      { side: 'only', kind: 'charge', key: 'kuangwu.charge', needsChoice: true },
      { side: 'only', kind: 'ultimate', key: 'kuangwu.ultimate' },
    ],
  },
  '025': {
    id: '025',
    name: '屠虎',
    weapon: '横刀',
    column: 1,
    speed: 4,
    will: 7,
    skills: [
      // 奇袭（持续·左）：可把「点数不在对方任意区域」的能力骰视为攻击骰使用
      { side: 'left', kind: 'continuous', key: 'tuohu.qixi' },
      // 横贯（持续·右）：本回合第 2 次攻击伤害 +2
      { side: 'right', kind: 'continuous', key: 'tuohu.hengguan' },
      // 横贯（触发·右）：攻击被抵挡后，可弃置对方 1 颗点数小于该攻击的能力骰
      { side: 'right', kind: 'trigger', key: 'tuohu.hengguan.trigger' },
    ],
  },
  '026': {
    id: '026',
    name: '哀歌',
    weapon: '明光铠',
    column: 2,
    distribution: { defense: [1, 6], attack: [3, 5], meditation: [2, 4] },
    skills: [
      // 陷阵（持续·左）：你的重掷阶段结束时，生命最少的一方弃置你 1 颗能力骰；随后你获得另外两种类型各 1 颗
      { side: 'left', kind: 'continuous', key: 'aige.xianzhen' },
      // 威压（触发·右）：使用 1 个任意能力骰后，可令自己或对方的 1 颗能力骰点数变为 4（保留原区域）
      { side: 'right', kind: 'trigger', key: 'aige.weiya', value: 4 },
    ],
  },
  '027': {
    id: '027',
    name: '寒光',
    weapon: '竹笛',
    column: 3,
    life: 50,
    chargeReq: 2,
    skills: [
      // 凛冽之音（充能）：直到你的下个尘起阶段开始，任何玩家重掷能力骰后，被重掷方受等量真实伤害
      { side: 'only', kind: 'charge', key: 'hanguang.charge' },
      // 凛冽之音（必杀）：取 1–6 各 1 颗置于本神器上；使用攻击骰前二选一（移入对应区域 / 移除并弃置对方同点数骰）
      { side: 'only', kind: 'ultimate', key: 'hanguang.ultimate' },
    ],
  },
};

export function makeArtifact(id: string): Artifact {
  const base = ARTIFACTS[id];
  if (!base) throw new Error(`unknown artifact: ${id}`);
  return {
    ...base,
    distribution: base.distribution
      ? {
          defense: [...base.distribution.defense],
          attack: [...base.distribution.attack],
          meditation: [...base.distribution.meditation],
        }
      : undefined,
    activeMarkerSide: null,
    armedSide: null,
    armedTurn: -1,
    count: 0,
    chargeLayer: 0,
    skills: base.skills.map((s) => ({ ...s })),
    heldDice: [],
  };
}


export const HEROES = {
  kong: { name: '雨中剑圣 空', artifacts: ['001', '002', '003'] },
  ying: { name: '永暗之刃 影', artifacts: ['004', '005', '006'] },
  batton: { name: '孤塔之王 巴顿二世', artifacts: ['007', '008', '009'] },
  tata: { name: '地狱的魔女 塔塔萝丝', artifacts: ['010', '011', '012'] },
  zoray: { name: '轰鸣审判官 佐雷', artifacts: ['013', '014', '015'] },
  xiu: { name: '漆黑死神 修', artifacts: ['016', '017', '018'] },
  nisa: { name: '荒野行者 尼萨', artifacts: ['019', '020', '021'] },
  xiva: { name: '黑枪 希瓦', artifacts: ['022', '023', '024'] },
  lifeng: { name: '天殇的战鬼 李封', artifacts: ['025', '026', '027'] },
} as const;
