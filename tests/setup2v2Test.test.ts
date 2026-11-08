import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderSetup, render2v2TestSetup } from '../src/ui/setupScreen';
import type { SetupOptions } from '../src/ui/setupScreen';

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
});

describe('2v2 测试牌组', () => {
  it('首页有测试2v2与团队作战入口', () => {
    const root = document.getElementById('app')!;
    renderSetup(root, vi.fn());
    expect(root.querySelector('[data-act="test2v2"]')).not.toBeNull();
    root.querySelector<HTMLElement>('[data-act="jubai"]')!.click();
    expect(root.querySelector('[data-act="team2v2"]')).not.toBeNull();
  });

  it('4 个英雄可选；异相勾选替换对应神器；重复英雄被拒绝', () => {
    const root = document.getElementById('app')!;
    const started: SetupOptions[] = [];
    render2v2TestSetup(root, vi.fn(), (opts) => started.push(opts));
    const selects = Array.from(root.querySelectorAll<HTMLSelectElement>('.b2v2-test-select'));
    expect(selects).toHaveLength(4);
    expect(selects.map((s) => s.value)).toEqual(['kong', 'ying', 'batton', 'tata']);

    selects[0]!.value = 'ying';
    selects[0]!.dispatchEvent(new Event('change'));
    expect(selects[0]!.value).toBe('kong');
    expect(root.querySelector('.b2v2-test-message')?.textContent).toContain('不能选择同一个英雄');

    const alt = root.querySelector<HTMLInputElement>('input[data-seat="A1"]')!;
    expect(alt.disabled).toBe(false);
    alt.checked = true;
    alt.dispatchEvent(new Event('change'));

    root.querySelector<HTMLButtonElement>('[data-act="startTest2v2"]')!.click();
    expect(started).toHaveLength(1);
    expect(started[0]!.twoVTwo?.startPhase).toBe(true);
    expect(started[0]!.twoVTwo?.seats.A1).toEqual(['C01', '002', '003']);
    expect(started[0]!.twoVTwo?.seats.A2).toEqual(['004', '005', '006']);
  });

  it('没有异相的英雄禁用复选框', () => {
    const root = document.getElementById('app')!;
    render2v2TestSetup(root, vi.fn(), vi.fn());
    const selects = Array.from(root.querySelectorAll<HTMLSelectElement>('.b2v2-test-select'));
    selects[0]!.value = 'xiva';
    selects[0]!.dispatchEvent(new Event('change'));
    expect(root.querySelector<HTMLInputElement>('input[data-seat="A1"]')!.disabled).toBe(true);
  });
});
