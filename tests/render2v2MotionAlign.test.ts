// 2v2 动画对齐 1v1 的「源码门禁」：锁住几条**一旦退回就会重演事故**的写法。
// 真实事故：2v2 的 attackStart 写死 `costDur: 0` → 005 影袭的灰骰与玩家色骰同时飞出（重影）；
//           `.b2v2-*` 入场动画随整块重绘反复复播 → 快速操作栏"闪一闪"。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const rawTs = import.meta.glob('../src/ui/{battle2v2View,render,motion}.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const raw: Record<string, string> = {
  ...rawTs,
  'styles.css': readFileSync(join(process.cwd(), 'src', 'ui', 'styles.css'), 'utf8'),
};

const pick = (name: string): string => {
  const key = Object.keys(raw).find((k) => k === name || k.endsWith(`/${name}`));
  return key ? raw[key]! : '';
};

const VIEW_SRC = pick('battle2v2View.ts');
const RENDER_SRC = pick('render.ts');
const MOTION_SRC = pick('motion.ts');
const CSS_SRC = pick('styles.css');

describe('2v2 动画对齐 1v1（源码门禁）', () => {
  it('源文件都读到了（防止路径写错导致空断言通过）', () => {
    expect(VIEW_SRC.length).toBeGreaterThan(10000);
    expect(RENDER_SRC.length).toBeGreaterThan(10000);
    expect(MOTION_SRC.length).toBeGreaterThan(10000);
    expect(CSS_SRC.length).toBeGreaterThan(10000);
  });

  it('1v1 / 2v2 都走共享 attackWatchDelay，禁止写死 costDur: 0', () => {
    expect(MOTION_SRC).toContain('export function attackWatchDelay');
    expect(RENDER_SRC).toContain('attackWatchDelay({');
    expect(VIEW_SRC).toContain('attackWatchDelay({');
    expect(VIEW_SRC).not.toMatch(/\n\s*costDur:\s*0\s*,/);
    expect(RENDER_SRC).not.toMatch(/\n\s*costDur:\s*0\s*,/);
    // 2v2 的起步延迟必须是算出来的值
    expect(VIEW_SRC).toMatch(/costDur:\s*watchDur/);
  });

  it('2v2 攻击支付要带置换（与 1v1 同款），否则"2 颗顶 1"的动画会缺', () => {
    expect(RENDER_SRC).toMatch(/substitution:\s*subOf\(/);
    expect(VIEW_SRC).toMatch(/substitution:\s*subOf\(/);
  });

  it('2v2 必须消费 attackJoin / gouhun（011·034 补骰、A06 勾魂）', () => {
    expect(VIEW_SRC).toContain("e.kind === 'attackJoin'");
    expect(VIEW_SRC).toContain("e.kind === 'gouhun'");
    // 被攻击池接管的骰子必须从通用"获得/让位"里排除，否则同一颗骰走两套动画（重影）
    expect(VIEW_SRC).toContain('for (const e of attackJoins) for (const id of e.dieIds) exclude.add(id);');
    expect(VIEW_SRC).toContain('for (const g of gouhuns) exclude.add(g.chipId);');
    expect(VIEW_SRC).toContain('attackJoin(root, {');
    expect(VIEW_SRC).toContain('playGouhun(root, gouhuns)');
    // 这两个动画的时长要计入本帧总时长，否则会被"提前收尾"
    expect(VIEW_SRC).toMatch(/Math\.max\([^)]*joinDur[^)]*gouhunDur/);
  });

  it('2v2 不许再给面板/浮层加入场动画（整块重绘会反复复播 → "闪一闪"）', () => {
    expect(CSS_SRC).not.toContain('@keyframes b2v2-');
    expect(CSS_SRC).not.toMatch(/animation:\s*b2v2-/);
    // 1v1 的 .selector 也没有入场动画 → 2v2 必须一致
    expect(CSS_SRC).not.toMatch(/\.battle2v2-root\s+\.selector\s*\{[^}]*animation:/);
  });

  it('2v2 的布局 FLIP 只由真实骰子变化触发（skipLayoutFlips=true）', () => {
    // skipLayoutFlips 之后还允许跟"生命抖动面板映射"（teamPanelsOf2v2）等参数
    expect(VIEW_SRC).toMatch(/runBoardMotions\([\s\S]{0,400}?true,/);
    // 非攻击生命变化必须把队伍映射传进去（否则 A/B 找不到面板 → 不抖）
    expect(VIEW_SRC).toMatch(/runBoardMotions\([\s\S]{0,400}?true,\s*teamPanelsOf2v2\(root\),\s*\);/);
  });

  it('2v2 换队帧必须把「新视角那一队」的获得骰延后（先切视角，再飞入）', () => {
    // 真实事故：上家结束、下家开始 → 下家的补充骰在旧视角里飞完才切画面。
    expect(VIEW_SRC).toContain('const deferAdds: PlayerId[] | null = holdView');
    expect(VIEW_SRC).toContain('SEATS.filter((s) => TEAM_OF[s] === viewTarget)');
    const at = VIEW_SRC.indexOf('const boardDur = runBoardMotions(');
    expect(at).toBeGreaterThan(0);
    const call = VIEW_SRC.slice(at, at + 600);
    // 第 5 个参数必须是 deferAdds（不许再写死 null）
    expect(call).toContain('deferAdds,');
    expect(call).not.toMatch(/false,\s*null,\s*\[\.\.\.exclude\]/);
  });

  it('2v2 每次重绘都要恢复"飞行中骰子"的隐藏（否则真骰提前显示）', () => {
    // 真实事故：全知（029）重排骰子时，替身还在中间飞，骰区已经显示真骰。
    // 1v1 靠 `restoreInFlightHides(root)` 兜住；2v2 之前完全没调。
    expect(VIEW_SRC).toContain('restoreInFlightHides(root)');
    const hideAt = VIEW_SRC.indexOf('restoreInFlightHides(root)');
    const motionAt = VIEW_SRC.indexOf('run2v2Motions(root');
    expect(hideAt).toBeGreaterThan(0);
    expect(motionAt).toBeGreaterThan(0);
    // 必须在播动画之前（否则第一帧就白做）
    expect(hideAt).toBeLessThan(motionAt);
  });

  it('2v2 攻击帧的受伤浮动时长必须计入 settle（否则换视角重建会切断抖动）', () => {
    // 真实事故 2026-11-08：每次"不抵挡"后 gen107 → 438/690/421ms → gen108（无动作重建＝换视角），
    // 而受伤浮动是排在 attackDur 之后才播的 → 抖动作用在已被重建替换掉的旧元素上 → 看不见。
    // 1v1 的对应时长由 `runBoardMotions` 的返回值携带（`lifeSpan`），所以 1v1 没这个问题。
    expect(VIEW_SRC).toMatch(/lifeFxDur\s*=\s*playLifeFloats\(/);
    const ret = VIEW_SRC.slice(VIEW_SRC.indexOf('return Math.max(payDur, boardDur'));
    expect(ret.slice(0, 300)).toContain('lifeFxDur');
  });
});
