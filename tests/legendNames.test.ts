import { describe, it, expect } from 'vitest';
import { LEGENDS } from '../src/core/content/legends';
import { LEGEND_TEXT } from '../src/core/content/legendText';
import { legendSkillNameOf } from '../src/ui/render';
import type { LegendPanel } from '../src/core/model/types';

const panel = (id: string): LegendPanel => ({ id, skills: LEGENDS[id].skills }) as unknown as LegendPanel;

describe('传奇技能名 · 按 key 精确定名（不再退回英雄名）', () => {
  it('L11 艾娃：三条技能各自取到自己的名字（三条全是"持续"，只能靠 key 区分）', () => {
    const lg = panel('L11');
    expect(legendSkillNameOf(lg, 'aiwa.qiangjiazhiuzui')).toBe('强加之罪');
    expect(legendSkillNameOf(lg, 'aiwa.xielingxuqu')).toBe('邪灵序曲');
    expect(legendSkillNameOf(lg, 'aiwa.yonghengnvwang')).toBe('永恒女王');
  });

  it('L01 空：两条技能都是"触发"，按 key 不串行', () => {
    const lg = panel('L01');
    expect(legendSkillNameOf(lg, 'kong.yuluo')).toBe('雨落狂流');
    expect(legendSkillNameOf(lg, 'kong.yuluo.trigger')).toBe('雨落狂流');
    expect(legendSkillNameOf(lg, 'kong.duanweiyizhan')).toBe('断苇一斩');
  });

  it('L04 玛特：持续 / 必杀 各取各的', () => {
    const lg = panel('L04');
    expect(legendSkillNameOf(lg, 'tata.wushangjianshu')).toBe('无上剑术');
    expect(legendSkillNameOf(lg, 'tata.mengjing')).toBe('我将在下个梦境与你再度相逢');
  });
});

describe('传奇技能名完备性门禁（保证气泡必然取到技能名）', () => {
  for (const id of Object.keys(LEGENDS)) {
    it(`${id}：LEGEND_TEXT 与 LEGENDS 技能数一致、每个 key 都有非空名字`, () => {
      const defs = LEGENDS[id].skills;
      const texts = LEGEND_TEXT[id]?.skills ?? [];
      // 同长（下标一一对应；legendFindKey 的 indexOf 亦依赖此对齐）
      expect(texts.length).toBe(defs.length);
      for (const t of texts) expect(t.name.trim().length).toBeGreaterThan(0);
      // 每个技能 key 都能通过真实映射取到非空名字（缺项/错位会让此断言失败）
      const lg = panel(id);
      for (const s of defs) expect(legendSkillNameOf(lg, s.key).length).toBeGreaterThan(0);
    });
  }
});
