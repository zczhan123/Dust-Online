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
const HERO_SETS = [KONG, YING, BAT, TATA];

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
    expect(root.querySelectorAll('[data-role="heroA"]').length).toBe(5); // 4 英雄 + 随机
    expect(root.querySelectorAll('[data-role="first"]').length).toBe(3);
  });

  it('defaults 随机 as selected for both rows', () => {
    renderSetup(root, () => {});
    expect(
      root.querySelector('[data-role="heroA"][data-value="random"]')!.classList.contains('selected'),
    ).toBe(true);
    expect(
      root.querySelector('[data-role="first"][data-value="random"]')!.classList.contains('selected'),
    ).toBe(true);
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
