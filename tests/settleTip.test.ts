import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { showSettleTip, hideSettleTip, attachSettleTip } from '../src/ui/settleTip';

describe('结算模式浮层：触屏不再卡住', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    hideSettleTip();
    vi.useRealTimers();
  });

  it('显示后 4 秒自动收起', () => {
    const a = document.createElement('button');
    document.body.appendChild(a);
    showSettleTip(a, 'favor');
    const tip = document.querySelector('.settle-tip') as HTMLElement;
    expect(tip.hidden).toBe(false);
    vi.advanceTimersByTime(4100);
    expect(tip.hidden).toBe(true);
  });

  it('点浮层/锚点以外 → 立即收起', () => {
    const a = document.createElement('button');
    document.body.appendChild(a);
    showSettleTip(a, 'favor');
    const tip = document.querySelector('.settle-tip') as HTMLElement;
    expect(tip.hidden).toBe(false);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(tip.hidden).toBe(true);
  });

  it('触屏 pointerenter 不显示（只有点击/长按才显示）', () => {
    const a = document.createElement('button');
    document.body.appendChild(a);
    attachSettleTip(a, 'favor');
    hideSettleTip();
    const ev = new Event('pointerenter');
    Object.defineProperty(ev, 'pointerType', { value: 'touch' });
    a.dispatchEvent(ev);
    const tip = document.querySelector('.settle-tip') as HTMLElement | null;
    expect(!tip || tip.hidden).toBe(true);
  });

  it('触屏点击也能显示（4 秒后自动收起）', () => {
    const a = document.createElement('button');
    document.body.appendChild(a);
    attachSettleTip(a, 'favor');
    hideSettleTip();
    a.click();
    const tip = document.querySelector('.settle-tip') as HTMLElement;
    expect(tip.hidden).toBe(false);
    vi.advanceTimersByTime(4100);
    expect(tip.hidden).toBe(true);
  });
});
