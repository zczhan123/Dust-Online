import { describe, it, expect, beforeEach } from 'vitest';
import { revealDieEls } from '../src/ui/motion';

/**
 * 回归（2026-10-18 真实事故）：动画层"延后获得的骰子"只加内联 `visibility:hidden`，
 * 却没有人揭出 → 骰子永远隐身（挑战/联机固定视角下大批出现）。
 * `revealDieEls` 是"揭出"的**唯一入口**：只清当前 DOM 里存在元素的样式。
 */
describe('motion · revealDieEls（揭出骰子）', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<div id="app">' +
      '<div class="panel"><div class="die" data-id="d1" data-value="4" style="visibility: hidden;"></div></div>' +
      '<div class="panel"><div class="die" data-id="d2" data-value="5" style="visibility: hidden; opacity: 1;"></div></div>' +
      '</div>';
  });

  it('清除指定骰子的内联 visibility（其余不碰）', () => {
    const root = document.getElementById('app')!;
    revealDieEls(root, ['d1']);
    expect(root.querySelector<HTMLElement>('.die[data-id="d1"]')!.style.visibility).toBe('');
    expect(root.querySelector<HTMLElement>('.die[data-id="d2"]')!.style.visibility).toBe('hidden');
  });

  it('不存在的 id → 安全无操作（已使用/消耗/弃置的骰子不会被"复活"）', () => {
    const root = document.getElementById('app')!;
    const before = root.innerHTML;
    expect(() => revealDieEls(root, ['gone-1', 'gone-2'])).not.toThrow();
    expect(root.innerHTML).toBe(before);
    expect(root.querySelector('.die[data-id="gone-1"]')).toBeNull();
  });
});
