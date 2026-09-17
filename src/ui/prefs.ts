/** 界面偏好（与对局状态解耦，存 localStorage） */
export interface Prefs {
  /** 是否在卡面显示技能描述（默认：隐藏，仅显示技能名） */
  showSkillText: boolean;
  /** 卡图尺寸 */
  cardArt: 'thumb' | 'full';
  /** 界面密度 */
  density: 'compact' | 'comfortable';
  /** 镜像神器摆放：敌方按「列3、列2、列1」显示（默认关） */
  mirrorEnemy: boolean;
  /** 当前预设组合（改任一单项即转为 custom） */
  preset: PresetId;
  /** 战报栏是否收起（收起后由贴边按钮拉出抽屉） */
  logCollapsed: boolean;
}

export type PresetId = 'desktop' | 'touch' | 'custom';

/** 电脑模式建议组合 */
export const DESKTOP_PRESET: Omit<Prefs, 'preset'> = {
  showSkillText: false,
  cardArt: 'thumb',
  density: 'compact',
  mirrorEnemy: false,
  logCollapsed: false,
};

/** 触屏/手机建议组合（字与点按目标更大；战报收起） */
export const TOUCH_PRESET: Omit<Prefs, 'preset'> = {
  showSkillText: false,
  cardArt: 'thumb',
  density: 'comfortable',
  mirrorEnemy: false,
  logCollapsed: true,
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
