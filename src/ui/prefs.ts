/** 界面偏好（与对局状态解耦，存 localStorage） */
export interface Prefs {
  /** 是否在卡面显示技能描述 */
  showSkillText: boolean;
  /** 卡图尺寸 */
  cardArt: 'thumb' | 'full';
  /** 界面密度 */
  density: 'compact' | 'comfortable';
  /** 镜像神器摆放：敌方按「列3、列2、列1」显示 */
  mirrorEnemy: boolean;
  /** 当前预设组合（改任一单项即转为 custom） */
  preset: PresetId;
  /** 战报栏是否收起（收起后由贴边按钮拉出抽屉） */
  logCollapsed: boolean;
  /** 整屏缩放：关 / 自动 / 手动 */
  zoomMode: 'off' | 'auto' | 'manual';
  /** 手动缩放百分比（80–100） */
  zoomPercent: number;
  /** 动画速度：正常 / 快（时长减半）。可省略＝正常；不参与「预设组合」 */
  animSpeed?: AnimSpeed;
}

export type AnimSpeed = 'normal' | 'fast';

export type PresetId = 'desktop' | 'touch' | 'custom';

type PresetValues = Omit<Prefs, 'preset' | 'animSpeed'>;

/** 电脑模式建议组合：紧凑 + 战报显示 + 完整卡图 + 技能显示 */
export const DESKTOP_PRESET: PresetValues = {
  showSkillText: true,
  cardArt: 'full',
  density: 'compact',
  mirrorEnemy: false,
  logCollapsed: false,
  zoomMode: 'off',
  zoomPercent: 90,
};

/** 触屏/手机建议组合：舒适 + 战报收起 + 缩略卡图 + 技能隐藏 */
export const TOUCH_PRESET: PresetValues = {
  showSkillText: false,
  cardArt: 'thumb',
  density: 'comfortable',
  mirrorEnemy: false,
  logCollapsed: true,
  zoomMode: 'off',
  zoomPercent: 90,
};

export const DEFAULT_PREFS: Prefs = { ...DESKTOP_PRESET, preset: 'desktop' };

export function clonePrefs(p: Prefs): Prefs {
  return {
    showSkillText: p.showSkillText,
    cardArt: p.cardArt,
    density: p.density,
    mirrorEnemy: p.mirrorEnemy,
    preset: p.preset,
    logCollapsed: p.logCollapsed,
    zoomMode: p.zoomMode,
    zoomPercent: p.zoomPercent,
    animSpeed: p.animSpeed,
  };
}

/** 套用某个预设组合（除 preset 外的全部字段） */
export function applyPreset(id: 'desktop' | 'touch'): Prefs {
  const base = id === 'touch' ? TOUCH_PRESET : DESKTOP_PRESET;
  return { ...base, preset: id };
}

/** 粗略判断是否移动端（用于首次进入时的默认预设） */
export function detectMobile(): boolean {
  try {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent ?? '' : '';
    if (/Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(ua)) return true;
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      if (window.matchMedia('(pointer: coarse)').matches) return true;
    }
    if (typeof window !== 'undefined' && typeof window.innerWidth === 'number') {
      if (window.innerWidth > 0 && window.innerWidth < 720) return true;
    }
  } catch {
    /* 忽略：按电脑处理 */
  }
  return false;
}

const KEY = 'dust.prefs.v1';

/** 读取偏好；读不到/结构不对就逐项回退默认值（避免旧数据把页面搞坏） */
export function loadPrefs(): Prefs {
  const fresh = detectMobile() ? applyPreset('touch') : clonePrefs(DEFAULT_PREFS);
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh;
    const data = JSON.parse(raw) as Partial<Prefs>;
    const out = fresh;
    if (typeof data?.showSkillText === 'boolean') out.showSkillText = data.showSkillText;
    if (data?.cardArt === 'thumb' || data?.cardArt === 'full') out.cardArt = data.cardArt;
    if (data?.density === 'compact' || data?.density === 'comfortable') out.density = data.density;
    if (typeof data?.mirrorEnemy === 'boolean') out.mirrorEnemy = data.mirrorEnemy;
    if (typeof data?.logCollapsed === 'boolean') out.logCollapsed = data.logCollapsed;
    if (data?.zoomMode === 'off' || data?.zoomMode === 'auto' || data?.zoomMode === 'manual') {
      out.zoomMode = data.zoomMode;
    }
    if (typeof data?.zoomPercent === 'number') {
      out.zoomPercent = Math.min(100, Math.max(50, Math.round(data.zoomPercent)));
    }
    if (data?.animSpeed === 'normal' || data?.animSpeed === 'fast') {
      out.animSpeed = data.animSpeed;
    }
    if (data?.preset === 'desktop' || data?.preset === 'touch' || data?.preset === 'custom') {
      out.preset = data.preset;
    }
    return out;
  } catch {
    return fresh;
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // localStorage 不可用（无痕/受限）时静默忽略：仅本次会话生效
  }
}

/** 动画速度 → 时长倍率（>1 = 更快；时长 = base / 倍率）。 */
export function speedOf(speed: AnimSpeed | undefined): number {
  return speed === 'fast' ? 2 : 1;
}
