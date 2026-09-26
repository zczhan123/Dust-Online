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
  '028': {
    id: '028',
    name: '天罚',
    weapon: '大剑',
    column: 1,
    speed: 4,
    will: 8,
    skills: [
      // 白昼之火（激活）：本回合你的攻击不可用防御骰抵挡，改为只能用冥想骰抵挡；攻击点数始终视为 6
      { side: 'left', kind: 'activation', key: 'tianfa.bairi' },
      // 陨落（激活）：同上，改为只能用攻击骰抵挡
      { side: 'right', kind: 'activation', key: 'tianfa.yunluo' },
    ],
  },
  '029': {
    id: '029',
    name: '真言',
    weapon: '圣典',
    column: 2,
    distribution: { defense: [1, 6], attack: [3, 4], meditation: [2, 5] },
    skills: [
      // 全知（持续）：速度 +1；补充阶段与重掷阶段不按常规分布落区，由玩家自行分配全部能力骰
      { side: 'left', kind: 'continuous', key: 'zhenyan.quanzhi' },
      // 神圣干涉（激活）：最多 3 颗能力骰统一改为指定点数并移到对应区域；然后回复 3 点生命
      { side: 'right', kind: 'activation', key: 'zhenyan.ganshe' },
    ],
  },
  '030': {
    id: '030',
    name: '救赎',
    weapon: '头环',
    column: 3,
    life: 45,
    chargeReq: 2,
    skills: [
      // 寰宇飞升（持续·双向）：双方各自回合的第一次攻击伤害 +3
      { side: 'only', kind: 'continuous', key: 'jiushu.huanyu' },
      // 寰宇飞升（必杀）：消耗 4 冥想骰 → 3 攻击骰 + 3 防御骰 → 回复 10 → 失去持续式
      { side: 'only', kind: 'ultimate', key: 'jiushu.huanyu.ultimate' },
    ],
  },
  '031': {
    id: '031',
    name: '恶兆',
    weapon: '匕首',
    column: 1,
    speed: 4,
    will: 7,
    countCap: 7,
    skills: [
      // 血祭（持续）：每次攻击后计数 +1（上限 7）；造成伤害后按新计数受等量真实伤害
      { side: 'left', kind: 'continuous', key: 'ezhao.xueji' },
      // 清算（激活）：弃置对方 X 颗（X=计数），每少 1 颗造成 3 真伤；随后计数 −1
      { side: 'right', kind: 'activation', key: 'ezhao.qingsuan' },
    ],
  },
  '032': {
    id: '032',
    name: '梦魇',
    weapon: '披风',
    column: 2,
    distribution: { defense: [1, 6], attack: [2, 5], meditation: [3, 4] },
    skills: [
      // 低语（持续）：主要阶段结束时宣称 1 个类型，获得 1 随机骰并移入该区；不符分布则尘落 +1
      { side: 'left', kind: 'continuous', key: 'mengyan.diyu' },
      // 恶意（启动）：消耗 1 攻击骰 → 获得 2 随机冥想骰
      { side: 'right', kind: 'activate', key: 'mengyan.eyi' },
      // 恶意（持续）：攻击伤害 + floor(冥想骰数 / 2)
      { side: 'right', kind: 'continuous', key: 'mengyan.eyi.continuous' },
    ],
  },
  '033': {
    id: '033',
    name: '凋零',
    weapon: '枷锁',
    column: 3,
    life: 40,
    chargeReq: 2,
    skills: [
      // 死亡亦逝（充能）：生命抹零——对方降至个位 0、自己尽可能回至个位 0（非伤害）
      { side: 'only', kind: 'charge', key: 'diaoling.charge' },
      // 死亡亦逝（持续）：双方各自回合结束时，择①全相同/②全不同并弃自己的能力骰
      { side: 'only', kind: 'continuous', key: 'diaoling.siwang' },
    ],
  },
  '035': {
    id: '035',
    name: '千劫',
    weapon: '佛灯',
    column: 2,
    distribution: { defense: [1, 6], attack: [3, 4], meditation: [2, 5] },
    skills: [
      // 万丈明光（持续）：速度 +3、意志 +2；你的主要阶段开始时，弃置 2 个能力骰
      { side: 'left', kind: 'continuous', key: 'qianjie.wanzhang' },
      // 超度（启动）：消耗 2 个点数相同的冥想骰 → 5 真伤 → 重掷任意玩家一区并按分布落区
      { side: 'right', kind: 'activate', key: 'qianjie.chaodu' },
    ],
  },
  '036': {
    id: '036',
    name: '无相',
    weapon: '念珠',
    column: 3,
    life: 50,
    chargeReq: 4,
    skills: [
      // 万象俱灭（充能·必执行）：弃任意玩家 1 个能力骰 → 该玩家回复 3 点生命（需选择 → needsChoice）
      { side: 'only', kind: 'charge', key: 'wuxiang.charge', needsChoice: true },
      // 万象俱灭（必杀）：双方 6 区 1–6 点各存时启动；各保留 1 个，弃其余全部，真伤=被弃不同点数之和
      { side: 'only', kind: 'ultimate', key: 'wuxiang.wanxiang.ultimate' },
    ],
  },
  '034': {
    id: '034',
    name: '金刚',
    weapon: '禅杖',
    column: 1,
    speed: 3,
    will: 8,
    skills: [
      // 破障（激活）：清空神器上存放骰 → 取 3 个点数互不相同的骰放神器上（不入区域）
      { side: 'left', kind: 'activation', key: 'jingang.pozhang' },
      // 破障（持续）：可将神器上的骰当作自己的能力骰使用/消耗（类型由点数决定）
      { side: 'left', kind: 'continuous', key: 'jingang.pozhang.continuous' },
      // 不动菩提（激活）：同上清空并取 3 个点数互不相同的骰
      { side: 'right', kind: 'activation', key: 'jingang.puti' },
      // 不动菩提（触发）：对方使用防御/攻击骰后，移除神器上同点数骰，取消其效果
      { side: 'right', kind: 'trigger', key: 'jingang.puti.trigger' },
    ],
  },
  // ── 异相神器（A01=009 孤王 / A02=010 深红 / A03=034 金刚；映射见 ALT_OF/BASE_OF）──
  'A01': { id: 'A01', name: '孤王', weapon: '王冠', column: 3, life: 50, chargeReq: 2, skills: [
    { side: 'only', kind: 'charge', key: 'guwang.alt.charge' },
    { side: 'only', kind: 'ultimate', key: 'guwang.ultimate' },
  ] },
  'A02': { id: 'A02', name: '深红', weapon: '刺剑', column: 1, speed: 3, will: 9, skills: [
    // 真实之剑（持续·左）：与 010 同 key，复用 010 的置换实现（canSwordConvert / paySlots）
    { side: 'left', kind: 'continuous', key: 'shenhong.sword' },
    // 哀悼（触发·右）：补充阶段实际补充 ≤3 时，造成 2 点真实伤害并弃置对方 1 个防御骰
    { side: 'right', kind: 'trigger', key: 'shenhong.alt.aidao' },
  ] },
  'A03': { id: 'A03', name: '金刚', weapon: '神杖', column: 1, speed: 4, will: 7, skills: [
    // 修罗的破障（激活）：清空神器上存放骰 → 取 2 个任意点数骰放神器上（可相同、不入区域）
    { side: 'left', kind: 'activation', key: 'jingang.alt.pozhang' },
    // 修罗的破障（持续）：与 034 同 key，复用破障存放骰「使用/消耗」实现
    { side: 'left', kind: 'continuous', key: 'jingang.pozhang.continuous' },
    // 修罗的菩提（激活）：同上清空并取 2 个任意点数骰
    { side: 'right', kind: 'activation', key: 'jingang.alt.puti' },
    // 修罗的菩提（触发）：与 034 同 key，复用不动菩提取消效果实现
    { side: 'right', kind: 'trigger', key: 'jingang.puti.trigger' },
  ] },
  // A04 = 020 兽魂 的异相：取消伤害阈值 1→2、且改由**持有者**决定；攻击伤害/速度 +计数（同基础）
  'A04': { id: 'A04', name: '兽魂', weapon: '爪', column: 2, distribution: { defense: [1, 6], attack: [2, 3], meditation: [4, 5] }, countCap: 2, skills: [
    { side: 'left', kind: 'activation', key: 'shouhun.alt.xiong' },
    { side: 'left', kind: 'continuous', key: 'shouhun.alt.xiong.continuous' },
    { side: 'right', kind: 'activation', key: 'shouhun.alt.lang' },
    { side: 'right', kind: 'continuous', key: 'shouhun.alt.lang.continuous' },
  ] },
  // A05 = 028 天罚 的异相：去掉"点数视为6"，改为攻击伤害 +3；抵挡限制/2 次结束同基础
  'A05': { id: 'A05', name: '天罚', weapon: '大剑', column: 1, speed: 4, will: 7, skills: [
    // 深空之火（激活）：本回合攻击不可用防御骰抵挡（只能用冥想骰）+ 攻击伤害 +3；2 次伤害后结束主要阶段
    { side: 'left', kind: 'activation', key: 'tianfa.alt.shenkong' },
    // 陨落（激活·异相）：同上，只能用攻击骰抵挡
    { side: 'right', kind: 'activation', key: 'tianfa.alt.yunluo' },
  ] },
  // A06 = 016 虚臾 的异相：两项持续（勾魂 / 幽魂不散）；速度 4、无基础"速度+2"
  'A06': { id: 'A06', name: '虚臾', weapon: '镰刀', column: 1, speed: 4, will: 8, skills: [
    // 勾魂（持续）：用"点数不在本神器上"的攻击骰造成伤害后，将该骰永久置于本神器上
    { side: 'left', kind: 'continuous', key: 'xuyu.alt.gouhun' },
    // 幽魂不散（持续）：防御/冥想骰被使用或弃置后，获得 X 点攻击骰（X=神器上攻击骰数；每回合上限 2）
    { side: 'right', kind: 'continuous', key: 'xuyu.alt.youhun' },
  ] },
  // A07 = 006 完杀 的异相：充能给防御骰(需求2)；必杀＝对方防御数≥我方攻击数→弃差额；本回合双方持续失效
  'A07': { id: 'A07', name: '完杀', weapon: '戒指', column: 3, life: 50, chargeReq: 2, skills: [
    { side: 'only', kind: 'charge', key: 'wansha.alt.charge' },
    { side: 'only', kind: 'ultimate', key: 'wansha.alt.ultimate' },
  ] },
  // A08 = 013 鸣雷 的异相：电刑（消耗2冥想→以 1/2/6 点依次攻击）+ 雷暴（触发同基础）；持续＝速度+2
  'A08': { id: 'A08', name: '鸣雷', weapon: '长枪', column: 1, speed: 2, will: 8, skills: [
    { side: 'left', kind: 'trigger', key: 'minglei.alt.dianxing' },
    { side: 'right', kind: 'trigger', key: 'minglei.leibao.trigger' },
    { side: 'right', kind: 'continuous', key: 'minglei.alt.leibao.continuous' },
  ] },
  // C01 = 001 雨切 的特典（替换版；不能在正式比赛中使用）：突破（任意数量冥想→弃对方等量防御）+ 极之境·裁雨流（重掷落区）
  'C01': { id: 'C01', name: '雨切', weapon: '武士刀', column: 1, speed: 4, will: 7, special: true, skills: [
    { side: 'left', kind: 'activate', key: 'c01.breakthrough' },
    { side: 'right', kind: 'trigger', key: 'c01.caiyuliu' },
  ] },
};

/** 异相/特典神器 ↔ 原版神器 映射（供选择界面「切换」与后续引擎识别）。 */
export const ALT_OF: Record<string, string> = { '009': 'A01', '010': 'A02', '034': 'A03', '020': 'A04', '028': 'A05', '016': 'A06', '006': 'A07', '013': 'A08', '001': 'C01' };
export const BASE_OF: Record<string, string> = { A01: '009', A02: '010', A03: '034', A04: '020', A05: '028', A06: '016', A07: '006', A08: '013', C01: '001' };
export const isAltArtifact = (id: string): boolean => id in BASE_OF;

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
  mate: { name: '破晓之剑 玛特', artifacts: ['028', '029', '030'] },
  aiwa: { name: '受缚邪灵 艾娃', artifacts: ['031', '032', '033'] },
  miyun: { name: '渡世行僧 弥云', artifacts: ['034', '035', '036'] },
} as const;
