import { describe, it, expect, afterEach } from 'vitest';
import { drawTrueLine } from '../src/ui/motion';

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

const stubRect = (el: HTMLElement, r: DOMRect): HTMLElement => {
  el.getBoundingClientRect = () => r;
  return el;
};

afterEach(() => {
  document.getElementById('fx-layer')?.remove();
  document.body.innerHTML = '';
});

describe('真伤白墨线 · drawTrueLine（发动卡 → 受伤方生命条）', () => {
  it('给定两端元素 → 往 fx 层插一条 .fx-line--truth 且返回正时长', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    stubRect(root, rect(0, 0, 800, 600)); // canAnimate：isConnected + 宽>0
    const from = stubRect(document.createElement('div'), rect(100, 100, 40, 20)); // 卡图中心 (120,110)
    const to = stubRect(document.createElement('div'), rect(500, 300, 120, 12)); // 生命条中心 (560,306)

    const dur = drawTrueLine(root, from, to);

    expect(dur).toBeGreaterThan(0);
    const line = document.getElementById('fx-layer')?.querySelector<HTMLElement>('.fx-line--truth');
    expect(line).not.toBeNull();
    // 起点＝卡图中心
    expect(line!.style.left).toBe('120px');
    expect(line!.style.top).toBe('110px');
  });

  it('缺任一端（from/to 为空）→ 不画、返回 0', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    stubRect(root, rect(0, 0, 800, 600));
    const from = stubRect(document.createElement('div'), rect(0, 0, 10, 10));

    expect(drawTrueLine(root, from, null)).toBe(0);
    expect(drawTrueLine(root, null, from)).toBe(0);
    expect(document.querySelector('.fx-line--truth')).toBeNull();
  });
});
