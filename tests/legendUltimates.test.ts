import { describe, it, expect } from 'vitest';
import { LEGENDS, makeLegend } from '../src/core/content/legends';
import { ARTIFACTS } from '../src/core/content/artifacts';
import { skillKindOf } from '../src/ui/render';
import { createGame } from '../src/core/engine/game';
import type { Artifact, SkillDef } from '../src/core/model/types';

/** 把某神器的结算技能定义塞进一个玩家（测试 skillKindOf 用）。 */
const holdArtifact = (g: ReturnType<typeof createGame>, id: string): void => {
  const def = ARTIFACTS[id];
  g.players.A.artifacts = [{ id, skills: def.skills.map((s: SkillDef) => ({ ...s })) } as unknown as Artifact];
};

describe('必杀判定门禁 · 所有 kind:ultimate 的 skillKindOf 必得 ultimate（→ 走居中横幅）', () => {
  // 传奇：枚举每个面板的必杀（含被运行时删除自身的情形）
  for (const id of Object.keys(LEGENDS)) {
    const ults = LEGENDS[id].skills.filter((s) => s.kind === 'ultimate');
    if (ults.length === 0) continue;
    it(`${id}：${ults.map((u) => u.key).join(' / ')} → ultimate`, () => {
      const g = createGame({ seed: 1, firstPlayer: 'A' });
      g.players.A.legend = makeLegend(id);
      for (const u of ults) expect(skillKindOf(g, 'A', id, u.key)).toBe('ultimate');
    });
  }

  it('L04 必杀用后从面板删掉自身 → 仍判为 ultimate', () => {
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    const lg = makeLegend('L04');
    lg.skills = lg.skills.filter((s) => s.key !== 'tata.mengjing');
    g.players.A.legend = lg;
    expect(skillKindOf(g, 'A', 'L04', 'tata.mengjing')).toBe('ultimate');
  });

  // 神器 / 异相：枚举所有必杀式
  for (const id of Object.keys(ARTIFACTS)) {
    const ults = ARTIFACTS[id].skills.filter((s) => s.kind === 'ultimate');
    if (ults.length === 0) continue;
    it(`${id}（神器/异相）：${ults.map((u) => u.key).join(' / ')} → ultimate`, () => {
      const g = createGame({ seed: 1, firstPlayer: 'A' });
      holdArtifact(g, id);
      for (const u of ults) expect(skillKindOf(g, 'A', id, u.key)).toBe('ultimate');
    });
  }
});
