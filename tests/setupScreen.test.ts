import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderSetup, type SetupOptions } from '../src/ui/setupScreen';

const click = (root: HTMLElement, selector: string): void => {
  const node = root.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`missing element: ${selector}`);
  node.click();
};

const KONG = ['001', '002', '003'];
const YING = ['004', '005', '006'];
const BAT = ['007', '008', '009'];
const TATA = ['010', '011', '012'];
const ZORAY = ['013', '014', '015'];
const XIU = ['016', '017', '018'];
const NISA = ['019', '020', '021'];
const XIVA = ['022', '023', '024'];
const LIFENG = ['025', '026', '027'];
const MATE = ['028', '029', '030'];
const AIWA = ['031', '032', '033'];
const MIYUN = ['034', '035', '036'];
const HERO_SETS = [KONG, YING, BAT, TATA, ZORAY, XIU, NISA, XIVA, LIFENG, MATE, AIWA, MIYUN];

describe('renderSetup', () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app')!;
  });

  it('renders the setup form and its choices', () => {
    renderSetup(root, () => {});
    expect(root.textContent).toContain('尘起时刻 · 开始新对局');
    expect(root.querySelector('.setup')).not.toBeNull();
    expect(root.querySelector('.setup-start')?.textContent).toBe('开始游戏');
    expect(root.querySelectorAll('[data-role="heroA"]').length).toBe(13); // 12 英雄 + 随机
    expect(root.querySelectorAll('[data-role="heroB"]').length).toBe(13); // 12 英雄 + 随机
    expect(root.querySelectorAll('[data-role="first"]').length).toBe(3);
  });

  it('marks the app root as the setup page (封面背景由 CSS 负责)', () => {
    renderSetup(root, () => {});
    expect(root.classList.contains('setup-page')).toBe(true);
  });

  it('首页右下角显示版本号小字（来源 package.json → __APP_VERSION__）', () => {
    renderSetup(root, () => {});
    const v = root.querySelector('.app-version');
    expect(v).not.toBeNull();
    expect(v!.textContent).toMatch(/^v/); // 形如 v0.1.0（测试兜底环境为 vdev）
  });

  it('选将矩阵：单列对齐，每个英雄恰好出现一次（不重不漏）', () => {
    renderSetup(root, () => {});
    // 14 行 = 表头 + 13 行（12 个英雄 + 随机）
    expect(root.querySelectorAll('.hero-matrix-row').length).toBe(14);
    const labels = Array.from(root.querySelectorAll('.hero-matrix-row .setup-label'))
      .map((n) => n.textContent)
      .filter((t) => t !== '');
    expect(labels).toEqual([
      '雨中剑圣·空',
      '永暗之刃·影',
      '孤塔之王·巴顿二世',
      '地狱的魔女·塔塔萝丝',
      '轰鸣审判官·佐雷',
      '漆黑死神·修',
      '荒野行者·尼萨',
      '黑枪·希瓦',
      '天殇的战鬼·李封',
      '破晓之剑·玛特',
      '受缚邪灵·艾娃',
      '渡世行僧·弥云',
      '随机',
    ]);
  });

  it('defaults 随机 as selected for both rows', () => {
    renderSetup(root, () => {});
    expect(
      root.querySelector('[data-role="heroA"][data-value="random"]')!.classList.contains('selected'),
    ).toBe(true);
    expect(
      root.querySelector('[data-role="heroB"][data-value="random"]')!.classList.contains('selected'),
    ).toBe(true);
    expect(
      root.querySelector('[data-role="first"][data-value="random"]')!.classList.contains('selected'),
    ).toBe(true);
  });

  it('disables the opposite column cell of the same specific hero', () => {
    renderSetup(root, () => {});
    // A 选“空” → B 的“空”单元格禁用
    click(root, '[data-role="heroA"][data-value="kong"]');
    const bKong = root.querySelector<HTMLButtonElement>('[data-role="heroB"][data-value="kong"]')!;
    expect(bKong.disabled).toBe(true);
    expect(bKong.classList.contains('choice--muted')).toBe(true);
    // 随机永不被互斥
    expect(
      root.querySelector<HTMLButtonElement>('[data-role="heroB"][data-value="random"]')!.disabled,
    ).toBe(false);

    // 回到 A=随机 后，B 选“空” → A 的“空”单元格禁用（反之亦然）
    click(root, '[data-role="heroA"][data-value="random"]');
    expect(bKong.disabled).toBe(false);
    click(root, '[data-role="heroB"][data-value="kong"]');
    const aKong = root.querySelector<HTMLButtonElement>('[data-role="heroA"][data-value="kong"]')!;
    expect(aKong.disabled).toBe(true);
    expect(aKong.classList.contains('choice--muted')).toBe(true);
  });

  it('starts deterministically when both columns pick specific heroes', () => {
    const onStart = vi.fn();
    renderSetup(root, onStart);
    click(root, '[data-role="heroA"][data-value="kong"]');
    click(root, '[data-role="heroB"][data-value="ying"]');
    click(root, '.setup-start');
    expect(onStart).toHaveBeenCalledTimes(1);
    const opts = onStart.mock.calls[0][0] as SetupOptions;
    expect(opts.heroA).toEqual(KONG);
    expect(opts.heroB).toEqual(YING);
  });

  it('selects 雨中剑圣·空 + 玩家A 先手 (对手是另一位英雄)', () => {
    const onStart = vi.fn();
    renderSetup(root, onStart);
    click(root, '[data-role="heroA"][data-value="kong"]');
    click(root, '[data-role="first"][data-value="A"]');
    expect(
      root.querySelector('[data-role="heroA"][data-value="kong"]')!.classList.contains('selected'),
    ).toBe(true);
    click(root, '.setup-start');
    expect(onStart).toHaveBeenCalledTimes(1);
    const opts = onStart.mock.calls[0][0] as SetupOptions;
    expect(opts.heroA).toEqual(KONG);
    expect(opts.firstPlayer).toBe('A');
    expect(HERO_SETS.some((h) => JSON.stringify(h) === JSON.stringify(opts.heroB))).toBe(true);
    expect(JSON.stringify(opts.heroB)).not.toBe(JSON.stringify(KONG));
  });

  it('can select 孤塔之王·巴顿二世', () => {
    const onStart = vi.fn();
    renderSetup(root, onStart);
    click(root, '[data-role="heroA"][data-value="batton"]');
    click(root, '.setup-start');
    expect(onStart).toHaveBeenCalledTimes(1);
    const opts = onStart.mock.calls[0][0] as SetupOptions;
    expect(opts.heroA).toEqual(BAT);
    expect(JSON.stringify(opts.heroB)).not.toBe(JSON.stringify(BAT));
  });

  it('resolves random defaults to two different heroes', () => {
    const onStart = vi.fn();
    renderSetup(root, onStart);
    click(root, '.setup-start');
    expect(onStart).toHaveBeenCalledTimes(1);
    const opts = onStart.mock.calls[0][0] as SetupOptions;
    expect(['A', 'B']).toContain(opts.firstPlayer);
    expect(HERO_SETS.some((h) => JSON.stringify(h) === JSON.stringify(opts.heroA))).toBe(true);
    expect(HERO_SETS.some((h) => JSON.stringify(h) === JSON.stringify(opts.heroB))).toBe(true);
    expect(JSON.stringify(opts.heroA)).not.toBe(JSON.stringify(opts.heroB));
  });

  it('shows mode/draft placeholder options (disabled, marked 开发中)', () => {
    renderSetup(root, () => {});
    expect(root.querySelectorAll('[data-role="mode"]').length).toBe(4);
    expect(root.querySelectorAll('[data-role="draft"]').length).toBe(4);
    // 默认可用项被选中
    expect(
      root.querySelector('[data-role="mode"][data-value="hotseat"]')!.classList.contains('selected'),
    ).toBe(true);
    expect(
      root.querySelector('[data-role="draft"][data-value="hero"]')!.classList.contains('selected'),
    ).toBe(true);
    // 占位项禁用并标注“开发中”
    const soon = Array.from(root.querySelectorAll<HTMLButtonElement>('.choice--soon'));
    expect(soon.length).toBe(6); // 3 个禁用模式 + 3 个禁用选将
    for (const b of soon) {
      expect(b.disabled).toBe(true);
      expect(b.textContent).toContain('开发中');
    }
  });
});
