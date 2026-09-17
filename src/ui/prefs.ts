/** 界面偏好（与对局状态解耦，存 localStorage） */
export interface Prefs {
  /** 是否在卡面显示技能描述（默认：隐藏，仅显示技能名） */
  showSkillText: boolean;
  /** 卡图尺寸 */
  cardArt: 'thumb' | 'full';
  /** 界面密度 */
  density: 'compact' | 'comfortable';
}

export const DEFAULT_PREFS: Prefs = {
  showSkillText: false,
  cardArt: 'thumb',
  density: 'compact',
};

export function clonePrefs(p: Prefs): Prefs {
  return { showSkillText: p.showSkillText, cardArt: p.cardArt, density: p.density };
}

const KEY = 'dust.prefs.v1';

/** 读取偏好；读不到/结构不对就逐项回退默认值（避免旧数据把页面搞坏） */
export function loadPrefs(): Prefs {
  const out = clonePrefs(DEFAULT_PREFS);
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return out;
    const data = JSON.parse(raw) as Partial<Prefs>;
    if (typeof data?.showSkillText === 'boolean') out.showSkillText = data.showSkillText;
    if (data?.cardArt === 'thumb' || data?.cardArt === 'full') out.cardArt = data.cardArt;
    if (data?.density === 'compact' || data?.density === 'comfortable') out.density = data.density;
  } catch {
    return clonePrefs(DEFAULT_PREFS);
  }
  return out;
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // localStorage 不可用（无痕/受限）时静默忽略：仅本次会话生效
  }
}
