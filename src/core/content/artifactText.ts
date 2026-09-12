export interface SkillText {
  side: 'left' | 'right' | 'only';
  name: string;
  type: string; // 启动 / 触发 / 持续 / 充能 / 必杀
  text: string;
}

export interface ArtifactText {
  title?: string;
  skills: SkillText[];
}

/**
 * 神器卡面展示文案（用于 UI 展示，非结算逻辑；精确效果定义见规则实现文档 §11 / 后续 Plan 3）。
 */
export const ARTIFACT_TEXT: Record<string, ArtifactText> = {
  '001': {
    skills: [
      {
        side: 'left',
        name: '中央突破',
        type: '启动',
        text: '消耗最多 3 个冥想骰。弃置对方同等数量的防御骰。如果你消耗了恰好 3 个冥想骰，直到本回合结束前，你的攻击不可抵挡。',
      },
      {
        side: 'right',
        name: '裁雨流',
        type: '触发',
        text: '当你使用攻击骰造成伤害后，你可以保留其点数，将其移动到你的防御骰区或冥想骰区。本技能每回合最多触发 3 次。',
      },
    ],
  },
  '002': {
    skills: [
      {
        side: 'left',
        name: '龙游万象',
        type: '持续',
        text: '你的速度 +1。在你的回合内的重掷阶段中，你可以进行最多 2 次重掷（每次重掷的数量最多等同于你的速度）。',
      },
      {
        side: 'right',
        name: '龙腾万丈',
        type: '启动',
        text: '消耗 3 个冥想骰。获得 4 个随机点数的能力骰，将其中点数最大和最小的能力骰各 1 个移动到攻击骰区，将另外 2 个能力骰移动到防御骰区。本回合中，你的攻击伤害 +1。',
      },
    ],
  },
  '003': {
    skills: [
      {
        side: 'only',
        name: '斩神切',
        type: '充能',
        text: '你可以立即再次进行 1 次需要正常使用冥想骰的额外“尘起行动”。',
      },
      {
        side: 'only',
        name: '斩神切',
        type: '必杀',
        text: '弃置你的全部能力骰。弃置对方与你弃置的能力骰对应种类、对应数量的能力骰。造成 X 点真实伤害，X 为以此法弃置的双方能力骰数量总和。之后，你获得 3 个随机点数的防御骰。',
      },
    ],
  },
  '004': {
    skills: [
      {
        side: 'left',
        name: '淬炼',
        type: '启动',
        text: '消耗 1 个攻击骰。本神器计数 +1（最高叠加至 3 层）。',
      },
      {
        side: 'right',
        name: '锋芒',
        type: '持续 / 触发',
        text: '持续：你的攻击伤害 +X，X 为本神器叠加的计数。触发：当你的攻击被防御骰抵挡后，你可以消耗 1 个攻击骰和 1 个冥想骰，取消该防御骰的效果，并再额外追加 2 点真实伤害。',
      },
    ],
  },
  '005': {
    skills: [
      {
        side: 'left',
        name: '影袭',
        type: '启动',
        text: '使你的 1 个能力骰点数下降 X 点（最低降为 1），并根据新的点数，将其移动到对应的区域。视为以 X 点进行 1 次攻击。',
      },
      {
        side: 'right',
        name: '潜行',
        type: '启动',
        text: '消耗 2 个攻击骰。获得 2 个随机点数的防御骰和 1 个随机点数的冥想骰。',
      },
    ],
  },
  '006': {
    skills: [
      {
        side: 'only',
        name: '零时枭首',
        type: '充能',
        text: '获得 1 个点数等同本神器当前充能层数的攻击骰。',
      },
      {
        side: 'only',
        name: '零时枭首',
        type: '必杀',
        text: '消耗 1 个攻击骰。弃置对方 X 个防御骰。之后，如果对方还有剩余的防御骰，你再获得 X 个随机点数的攻击骰。X 为你消耗的攻击骰的点数。',
      },
    ],
  },
};
