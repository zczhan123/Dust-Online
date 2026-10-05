import { describe, it, expect } from 'vitest';
import { createGame, skipInitialReroll } from '../src/core/engine/game';
import { skillKindOf } from '../src/ui/render';
import { LEGENDS } from '../src/core/content/legends';
import type { GameState } from '../src/core/model/types';

describe('必杀判定（skillKindOf）—— 供"必杀走大横幅、不再从卡图弹"用', () => {
  it('神器：必杀 → ultimate；其它 kind 各自正确', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A', heroA: ['001', '002', '003'], heroB: ['004', '005', '006'] });
    skipInitialReroll(g);
    expect(skillKindOf(g, 'A', '003', 'mingjing.ultimate')).toBe('ultimate');
    expect(skillKindOf(g, 'A', '003', 'mingjing.charge')).toBe('charge');
    expect(skillKindOf(g, 'A', '001', 'yuqie.breakthrough')).toBe('activate');
    expect(skillKindOf(g, 'A', '001', 'yuqie.caiyuliu')).toBe('trigger');
  });

  it('传奇面板：必杀 → ultimate（L01–L12 同走横幅）', () => {
    const fake = {
      players: { A: { artifacts: [], legend: { id: 'L12', skills: LEGENDS.L12.skills } } },
    } as unknown as GameState;
    expect(skillKindOf(fake, 'A', 'L12', 'miyun.lidichengfo')).toBe('ultimate');
    expect(skillKindOf(fake, 'A', 'L12', 'miyun.putixin')).toBe('continuous');
  });

  it('无 skillKey → undefined（不影响非必杀路径）', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    skipInitialReroll(g);
    expect(skillKindOf(g, 'A', '001', undefined)).toBeUndefined();
  });
});
