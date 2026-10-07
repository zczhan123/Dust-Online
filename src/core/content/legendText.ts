import type { ArtifactText } from './artifactText';

/**
 * 传奇英雄面板的卡面展示文案（UI 用，非结算逻辑）。
 * 与 `ARTIFACT_TEXT` 同构；`side` 恒为 'only'（面板没有左右侧、也没有激活步骤）。
 * 结算定义见 `legends.ts` 的 `LEGENDS[id].skills` 与各技能实现。
 */
export const LEGEND_TEXT: Record<string, ArtifactText> = {
  L01: {
    skills: [
      {
        side: 'only',
        key: 'kong.yuluo',
        name: '雨落狂流',
        type: '持续',
        text: '每当你使用、消耗、或弃置任意数量不符合骰点分布的能力骰后，「雨落狂流」的计数 +1。',
      },
      {
        side: 'only',
        key: 'kong.yuluo.trigger',
        name: '雨落狂流',
        type: '触发',
        text: '当「雨落狂流」的计数达到 3 时，将计数重设为 0，并可以选择 1 项执行：① 弃置对方的 1 个能力骰。② 获得 1 个随机点数的能力骰，并移动至你的任意区域。',
      },
      {
        side: 'only',
        key: 'kong.duanweiyizhan',
        name: '断苇一斩',
        type: '触发',
        text: '如果你在你的一整个回合中没有造成任何伤害，则你的下个回合中，当你启动「斩神切」时，你可以将对方需要弃置的能力骰改为对方的全部能力骰。',
      },
    ],
  },
  L02: {
    skills: [
      {
        side: 'only',
        key: 'ying.canying',
        name: '残影',
        type: '持续',
        text: '你的「影袭」每回合可以启动最多 2 次。你在每个尘起阶段可以进行最多 2 次“尘起行动”。',
      },
      {
        side: 'only',
        key: 'ying.anyexiongshen',
        name: '暗夜凶神',
        type: '触发',
        text: '当你通过「锋芒」取消对方的防御骰后，你可以使「不祥」的计数 +1（最高叠加至 3 层）。',
      },
      {
        side: 'only',
        key: 'ying.zangdihua',
        name: '潸然的葬敌花',
        type: '必杀',
        text: '尘落前置 1。双方各自获得 3 个随机点数的能力骰。',
      },
    ],
  },
  L12: {
    skills: [
      {
        side: 'only',
        key: 'miyun.putixin',
        name: '见我身者菩提心',
        type: '持续',
        text: '当你的生命回复时，额外回复 X 点生命。X 为对方的区域中不存在能力骰的区域数量。',
      },
      {
        side: 'only',
        key: 'miyun.duanexing',
        name: '闻我名者断恶行',
        type: '触发',
        text: '当你受到伤害后。你可以弃置对方 1 个攻击骰。本技能每回合最多触发 1 次。',
      },
      {
        side: 'only',
        key: 'miyun.lidichengfo',
        name: '知我心者立地成佛',
        type: '必杀',
        text: '尘落前置 3。在双方的所有区域中，每有 1 个有且只有 1 种点数的区域，便造成 6 点真实伤害。之后，弃置这些区域中的能力骰。',
      },
    ],
  },
  L11: {
    skills: [
      {
        side: 'only',
        key: 'aiwa.qiangjiazhiuzui',
        name: '强加之罪',
        type: '持续',
        text: '你的意志始终为 6。',
      },
      {
        side: 'only',
        key: 'aiwa.xielingxuqu',
        name: '邪灵序曲',
        type: '持续',
        text: '每当有玩家的生命下降，「邪灵序曲」叠加等量的计数（最高叠加至 99 层）。你的回合结束时，造成等同于「邪灵序曲」计数的十位数显示的数字的真实伤害。',
      },
      {
        side: 'only',
        key: 'aiwa.yonghengnvwang',
        name: '永恒女王',
        type: '持续',
        text: '当你受到能让你死亡的伤害时，取消该伤害，取消所有尚待结算的效果和阶段，立即开始 1 个你的全新回合。本技能整局游戏最多生效 1 次。',
      },
    ],
  },
  L10: {
    skills: [
      {
        side: 'only',
        key: 'mate.dizuidaijianshu',
        name: '涤罪大剑术',
        type: '触发',
        text: '当你进行 1 次"尘起行动"后，如果你的第一列神器与第二列神器的激活标记在同一侧。你可以弃置对方 2 个种类不相同的能力骰。',
      },
      {
        side: 'only',
        key: 'mate.nudengzuiren',
        name: '汝等罪人',
        type: '触发',
        text: '当你将要回复生命时。你可以改为造成等量的真实伤害。',
      },
      {
        side: 'only',
        key: 'mate.chilaidezhengyi',
        name: '迟来的正义',
        type: '持续',
        text: '你的攻击伤害 +X。X 为当前的尘落，且最大为 4。',
      },
    ],
  },
  L09: {
    skills: [
      {
        side: 'only',
        key: 'lifeng.tunhuzhilang',
        name: '吞虎之狼',
        type: '持续',
        text: '你在每个回合中进行的第三次攻击伤害 +3。',
      },
      {
        side: 'only',
        key: 'lifeng.aozhan',
        name: '鏖战',
        type: '持续',
        text: '你的主要阶段结束时，如果你有能力骰，且「陷阵」处于激活状态，再次执行 1 次「陷阵」。',
      },
      {
        side: 'only',
        key: 'lifeng.bianyecansha',
        name: '遍野残杀',
        type: '必杀',
        text: '尘落前置 2。你的所有神器均处于激活状态时才能启动。你的所有神器的左右两侧技能全部视为处于激活状态。你的回合结束时，你立即死亡。',
      },
    ],
  },
  L08: {
    skills: [
      {
        side: 'only',
        key: 'xiva.shexiezhilei',
        name: '蛇蝎之泪',
        type: '持续',
        text: '当你启动「填弹」后，你受到 X 点真实伤害。X 为你本回合中通过「填弹」叠加的计数的平方数（自身乘以自身）。',
      },
      {
        side: 'only',
        key: 'xiva.zhiweishangjin',
        name: '只为赏金而来',
        type: '触发',
        text: '当你触发「处刑通牒」后。你可以立即启动你的 1 个激活状态中的"启动式"技能，且不计入每回合 1 次的启动上限。',
      },
      {
        side: 'only',
        key: 'xiva.meiyoulianmin',
        name: '没有怜悯',
        type: '持续',
        text: '尘落前置 4。无论你的「狂舞」是否处于激活状态，你每个回合都能启动 1 次「凶弹业舞」。每次启动「凶弹业舞」后，你受到 2 点真实伤害。',
      },
    ],
  },
  L07: {
    skills: [
      {
        side: 'only',
        key: 'nisa.wujinzhulie',
        name: '无尽追猎',
        type: '持续',
        text: '你的攻击骰区中的最后 1 个攻击骰不可抵挡。',
      },
      {
        side: 'only',
        key: 'nisa.shizushouhun',
        name: '始祖兽魂',
        type: '触发',
        text: '当你激活「兽魂」时。你可以额外消耗 1 个冥想骰，改为将其计数重设为 3。',
      },
      {
        side: 'only',
        key: 'nisa.buqupaoxiao',
        name: '不屈咆哮',
        type: '必杀',
        text: '尘落前置 2。弃置对方数量等同于你的「决意」当前计数的能力骰，然后将「决意」的计数重设为 1。',
      },
    ],
  },
  L06: {
    skills: [
      {
        side: 'only',
        key: 'xiu.yuanwu',
        name: '圆舞',
        type: '持续',
        text: '每当你受到自己造成的伤害后，你必须将你的 1 个任意能力骰移动至你的另 1 个区域。',
      },
      {
        side: 'only',
        key: 'xiu.wuguanglingyu',
        name: '无光领域',
        type: '启动',
        text: '你受到 4 点真实伤害。从以下两项中选择 1 项，直到你下次启动「无光领域」前，这个效果都会持续生效：① 你的攻击点数视为上升 1 点（最大为 6）。② 你的攻击点数视为下降 1 点（最小为 1）。',
      },
      {
        side: 'only',
        key: 'xiu.sijixinsheng',
        name: '死即新生',
        type: '持续',
        text: '当你因自己造成的伤害死亡时，改为将生命重设为 13。',
      },
    ],
  },
  L05: {
    skills: [
      {
        side: 'only',
        key: 'zoray.fuchouzhiling',
        name: '复仇之灵',
        type: '持续',
        text: '当你的生命十位数发生变化后，你立即进行 1 次无需使用冥想骰的额外“尘起行动”。',
      },
      {
        side: 'only',
        key: 'zoray.wufaraoshu',
        name: '无法饶恕',
        type: '触发',
        text: '每当你的攻击造成伤害后，你可以弃置对方 1 个点数与该攻击点数相同的防御骰。',
      },
      {
        side: 'only',
        key: 'zoray.juedi',
        name: '绝地惊雷',
        type: '必杀',
        text: '尘落前置 3。你受到等同双方生命差值的真实伤害。获得 1 个 6 点的攻击骰。',
      },
    ],
  },
  L04: {
    skills: [
      {
        side: 'only',
        key: 'tata.wushangjianshu',
        name: '无上剑术',
        type: '持续',
        text: '每当你使用 5 点的攻击骰后，你回复 1 点生命。每当你使用 5 点的防御骰后，你造成 1 点真实伤害。',
      },
      {
        side: 'only',
        key: 'tata.mengjing',
        name: '我将在下个梦境与你再度相逢',
        type: '必杀',
        text: '尘落前置 0。继承本技能启动时双方的生命、尘落，以及技能计数；由你决定先手玩家，然后从获得初始能力骰的步骤，重新开始本局游戏。将其余的状态（能力骰、激活标记，以及充能等）重置为战斗开始时，并失去本技能。',
      },
    ],
  },
  L03: {
    skills: [
      {
        side: 'only',
        key: 'batton.wudi',
        name: '无敌',
        type: '持续',
        text: '你没有初始的能力骰。你的初始生命 +20。',
      },
      {
        side: 'only',
        key: 'batton.bacheng',
        name: '拔城',
        type: '触发',
        text: '当你启动「主宰」的技能后，如果对方弃置的能力骰数量少于你消耗的能力骰数量，你可以视为以 5 点进行 1 次攻击，然后切换你的「主宰」的技能。',
      },
      {
        side: 'only',
        key: 'batton.tongyuzhancang',
        name: '统御战场',
        type: '持续',
        text: '每当你受到攻击造成的伤害后，你的「孤王」充能 +1。',
      },
    ],
  },
};
