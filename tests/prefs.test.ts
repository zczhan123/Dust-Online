import { describe, it, expect } from 'vitest';
import { DEFAULT_PREFS, DESKTOP_PRESET, TOUCH_PRESET, applyPreset } from '../src/ui/prefs';

describe('界面默认/预设（2026-10 用户口径）', () => {
  it('电脑：技能显示 / 缩略卡图 / 紧凑 / 镜像 / 战报显示 / 整屏自动', () => {
    expect({
      showSkillText: DESKTOP_PRESET.showSkillText,
      cardArt: DESKTOP_PRESET.cardArt,
      density: DESKTOP_PRESET.density,
      mirrorEnemy: DESKTOP_PRESET.mirrorEnemy,
      logCollapsed: DESKTOP_PRESET.logCollapsed,
      zoomMode: DESKTOP_PRESET.zoomMode,
    }).toEqual({
      showSkillText: true,
      cardArt: 'thumb',
      density: 'compact',
      mirrorEnemy: true,
      logCollapsed: false,
      zoomMode: 'auto',
    });
  });

  it('触屏：技能缩略 / 缩略卡图 / 紧凑 / 镜像 / 战报缩略 / 整屏自动', () => {
    expect({ ...TOUCH_PRESET }).toEqual({
      showSkillText: false,
      cardArt: 'thumb',
      density: 'compact',
      mirrorEnemy: true,
      logCollapsed: true,
      zoomMode: 'auto',
      zoomPercent: 90,
    });
  });

  it('默认＝电脑预设；套用触屏预设同样镜像', () => {
    expect(DEFAULT_PREFS.preset).toBe('desktop');
    expect(applyPreset('touch').mirrorEnemy).toBe(true);
    expect(applyPreset('desktop').zoomMode).toBe('auto');
  });
});
