import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderSetup, type SetupOptions } from '../src/ui/setupScreen';

const click = (root: HTMLElement, selector: string): void => {
  const node = root.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`missing element: ${selector}`);
  node.click();
};

const KONG = ['001', '002', '003'];
const YING = ['004', '005', '006'];

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
    expect(root.querySelectorAll('[data-role="heroA"]').length).toBe(3);
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

  it('selects 雨中剑圣·空 + 玩家A 先手', () => {
    const onStart = vi.fn();
    renderSetup(root, onStart);
    click(root, '[data-role="heroA"][data-value="kong"]');
    click(root, '[data-role="first"][data-value="A"]');
    expect(
      root.querySelector('[data-role="heroA"][data-value="kong"]')!.classList.contains('selected'),
    ).toBe(true);
    click(root, '.setup-start');
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith({
      heroA: KONG,
      heroB: YING,
      firstPlayer: 'A',
    });
  });

  it('selects 永暗之刃·影 + 玩家B 先手', () => {
    const onStart = vi.fn();
    renderSetup(root, onStart);
    click(root, '[data-role="heroA"][data-value="ying"]');
    click(root, '[data-role="first"][data-value="B"]');
    click(root, '.setup-start');
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith({
      heroA: YING,
      heroB: KONG,
      firstPlayer: 'B',
    });
  });

  it('resolves random defaults to a valid, complete option pair', () => {
    const onStart = vi.fn();
    renderSetup(root, onStart);
    click(root, '.setup-start');
    expect(onStart).toHaveBeenCalledTimes(1);
    const opts = onStart.mock.calls[0][0] as SetupOptions;
    expect(['A', 'B']).toContain(opts.firstPlayer);
    const isKong = JSON.stringify(opts.heroA) === JSON.stringify(KONG);
    const isYing = JSON.stringify(opts.heroA) === JSON.stringify(YING);
    expect(isKong || isYing).toBe(true);
    expect(JSON.stringify(opts.heroB)).toBe(JSON.stringify(isKong ? YING : KONG));
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
