import { describe, it, expect } from 'vitest';
import { LEGENDS } from '../src/core/content/legends';
import { LEGEND_TEXT } from '../src/core/content/legendText';
import { legendSkillNameOf, skillKindOf } from '../src/ui/render';
import { createGame } from '../src/core/engine/game';
import type { LegendPanel } from '../src/core/model/types';

const panel = (id: string): LegendPanel =>
  ({ id, skills: LEGENDS[id].skills.map((s) => ({ ...s })) }) as unknown as LegendPanel;

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

  it('L04 必杀用后**从面板删掉自身**：名字与 kind 仍正确、仍判为必杀（走居中横幅）', () => {
    const lg = panel('L04');
    lg.skills = lg.skills.filter((s) => s.key !== 'tata.mengjing'); // 模拟 skills.ts 的删除
    // 名字：按 key 解析，不受"技能表被删"影响
    expect(legendSkillNameOf(lg, 'tata.mengjing')).toBe('我将在下个梦境与你再度相逢');
    // kind：从静态 LEGENDS 取 → 仍是必杀 → 界面会走居中横幅
    const g = createGame({ seed: 1, firstPlayer: 'A' });
    g.players.A.legend = lg;
    expect(skillKindOf(g, 'A', 'L04', 'tata.mengjing')).toBe('ultimate');
    expect(skillKindOf(g, 'A', 'L04', 'tata.wushangjianshu')).toBe('continuous');
  });
});

describe('传奇技能名完备性门禁（保证气泡必然取到技能名）', () => {
  for (const id of Object.keys(LEGENDS)) {
    it(`${id}：LEGEND_TEXT 与 LEGENDS 逐条 key 一一对应、每个 key 都有非空名字`, () => {
      const defs = LEGENDS[id].skills;
      const texts = LEGEND_TEXT[id]?.skills ?? [];
      expect(texts.length).toBe(defs.length);
      for (let i = 0; i < defs.length; i++) {
        expect(texts[i].key).toBe(defs[i].key); // 按 key 对齐（比"只查数量"更严，能抓重排）
        expect(texts[i].name.trim().length).toBeGreaterThan(0);
      }
      const lg = panel(id);
      for (const s of defs) expect(legendSkillNameOf(lg, s.key).length).toBeGreaterThan(0);
    });
  }
});
