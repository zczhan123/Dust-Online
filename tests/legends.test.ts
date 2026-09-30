import { describe, it, expect } from 'vitest';
import {
  LEGENDS,
  LEGEND_HERO_ORDER,
  LEGEND_OF_HERO,
  legendOfTrio,
  makeLegend,
} from '../src/core/content/legends';
import { setupGame } from '../src/core/engine/setup';
import { hasActiveSkill } from '../src/core/engine/skill-state';
import { totalDice } from '../src/core/engine/derive';

describe('legends（传奇英雄面板 · 内容）', () => {
  it('12 块，L01–L12 与 12 个英雄一一绑定', () => {
    expect(Object.keys(LEGENDS)).toEqual([
      'L01', 'L02', 'L03', 'L04', 'L05', 'L06',
      'L07', 'L08', 'L09', 'L10', 'L11', 'L12',
    ]);
    expect(LEGEND_HERO_ORDER).toHaveLength(12);
    expect(LEGENDS.L01.heroKey).toBe('kong');
    expect(LEGENDS.L01.artifacts).toEqual(['001', '002', '003']);
    expect(LEGENDS.L12.heroKey).toBe('miyun');
    expect(LEGENDS.L12.artifacts).toEqual(['034', '035', '036']);
    expect(LEGEND_OF_HERO.kong).toBe('L01');
    expect(LEGEND_OF_HERO.miyun).toBe('L12');
  });

  it('legendOfTrio：英雄三件套反查面板 id；非三件套 → undefined', () => {
    expect(legendOfTrio(['001', '002', '003'])).toBe('L01');
    expect(legendOfTrio(['034', '035', '036'])).toBe('L12');
    expect(legendOfTrio(['001', '002', '004'])).toBeUndefined();
  });

  it('makeLegend：运行时面板（count 0 / 含面板技能）；未知 id 抛错', () => {
    const lg = makeLegend('L01');
    expect(lg.id).toBe('L01');
    expect(lg.heroKey).toBe('kong');
    expect(lg.name).toBe(LEGENDS.L01.name);
    expect(lg.count).toBe(0);
    expect(lg.skills.map((s) => s.key)).toEqual(['kong.yuluo', 'kong.yuluo.trigger', 'kong.duanweiyizhan']);
    expect(() => makeLegend('L99')).toThrow();
  });

  it('L01–L12 面板技能已登记', () => {
    expect(LEGENDS.L02.skills.map((s) => s.key)).toEqual(['ying.canying', 'ying.anyexiongshen', 'ying.zangdihua']);
    expect(LEGENDS.L03.skills.map((s) => s.key)).toEqual(['batton.wudi', 'batton.bacheng', 'batton.tongyuzhancang']);
    expect(LEGENDS.L04.skills.map((s) => s.key)).toEqual(['tata.wushangjianshu', 'tata.mengjing']);
    expect(LEGENDS.L05.skills.map((s) => s.key)).toEqual([
      'zoray.fuchouzhiling',
      'zoray.wufaraoshu',
      'zoray.juedi',
    ]);
    expect(LEGENDS.L06.skills.map((s) => s.key)).toEqual([
      'xiu.yuanwu',
      'xiu.wuguanglingyu',
      'xiu.sijixinsheng',
    ]);
    expect(LEGENDS.L07.skills.map((s) => s.key)).toEqual([
      'nisa.wujinzhulie',
      'nisa.shizushouhun',
      'nisa.buqupaoxiao',
    ]);
    expect(LEGENDS.L08.skills.map((s) => s.key)).toEqual([
      'xiva.shexiezhilei',
      'xiva.zhiweishangjin',
      'xiva.meiyoulianmin',
    ]);
    expect(LEGENDS.L09.skills.map((s) => s.key)).toEqual([
      'lifeng.tunhuzhilang',
      'lifeng.aozhan',
      'lifeng.bianyecansha',
    ]);
    expect(LEGENDS.L10.skills.map((s) => s.key)).toEqual([
      'mate.dizuidaijianshu',
      'mate.nudengzuiren',
      'mate.chilaidezhengyi',
    ]);
    expect(LEGENDS.L11.skills.map((s) => s.key)).toEqual([
      'aiwa.qiangjiazhiuzui',
      'aiwa.xielingxuqu',
      'aiwa.yonghengnvwang',
    ]);
    // L11 的面板计数上限 99（L11「邪灵序曲」）
    expect(LEGENDS.L11.countCap).toBe(99);
    expect(LEGENDS.L10.countCap).toBeUndefined();
    expect(LEGENDS.L12.skills.map((s) => s.key)).toEqual([
      'miyun.putixin',
      'miyun.duanexing',
      'miyun.lidichengfo',
    ]);
    expect(LEGENDS.L12.countCap).toBeUndefined();
  });
});

describe('setup（传奇面板接线）', () => {
  it('legendA/legendB → players[A/B].legend', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L01', legendB: 'L12' });
    expect(g.players.A.legend?.id).toBe('L01');
    expect(g.players.B.legend?.id).toBe('L12');
    expect(g.players.A.legend?.name).toBe(LEGENDS.L01.name);
    expect(g.players.A.legend?.skills.map((s) => s.key)).toEqual([
      'kong.yuluo',
      'kong.yuluo.trigger',
      'kong.duanweiyizhan',
    ]);
  });

  it('hasActiveSkill 含传奇面板技能（开局即“已激活”，无需激活步骤）', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L01' });
    expect(hasActiveSkill(g.players.A, 'kong.yuluo')).toBe(true);
    expect(hasActiveSkill(g.players.A, 'ying.canying')).toBe(false);
    expect(hasActiveSkill(g.players.B, 'kong.yuluo')).toBe(false);
  });

  it('L03「无敌」：没有初始能力骰；初始生命 +20、上限不变', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A', legendA: 'L03' });
    expect(totalDice(g.players.A)).toBe(0);
    expect(g.players.A.life).toBe(70);
    expect(g.players.A.lifeMax).toBe(70);
    // 另一方（无传奇）正常
    expect(totalDice(g.players.B)).toBe(8);
    expect(g.players.B.life).toBe(50);
  });

  it('未传 legend → legend 为 null', () => {
    const g = setupGame({ seed: 1, firstPlayer: 'A' });
    expect(g.players.A.legend ?? null).toBeNull();
    expect(g.players.B.legend ?? null).toBeNull();
  });
});
