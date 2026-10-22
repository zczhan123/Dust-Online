import { describe, it, expect } from 'vitest';
import { restoreInFlightHides } from '../src/ui/motion';

function fxLayer(ids: string[]): HTMLDivElement {
  document.getElementById('fx-layer')?.remove();
  const layer = document.createElement('div');
  layer.id = 'fx-layer';
  for (const id of ids) {
    const g = document.createElement('div');
    g.dataset.animId = id;
    layer.appendChild(g);
  }
  document.body.appendChild(layer);
  return layer;
}

describe('restoreInFlightHides：重绘后恢复"飞行中骰子"的隐藏', () => {
  it('有克隆在飞 → 重绘后的真骰重新隐藏；无克隆 → 不动', () => {
    const layer = fxLayer(['x1']);
    const root = document.createElement('div');
    const d1 = document.createElement('div');
    d1.className = 'die die-A';
    d1.dataset.id = 'x1';
    const d2 = document.createElement('div');
    d2.className = 'die die-A';
    d2.dataset.id = 'x2';
    root.append(d1, d2);

    restoreInFlightHides(root);
    expect(d1.style.visibility).toBe('hidden');
    expect(d2.style.visibility).toBe('');

    // 克隆落地后不再强制隐藏（揭出由动画收尾负责）
    layer.innerHTML = '';
    d1.style.visibility = '';
    restoreInFlightHides(root);
    expect(d1.style.visibility).toBe('');
    layer.remove();
  });

  it('存放骰 chip 同样被恢复隐藏', () => {
    const layer = fxLayer(['c1']);
    const root = document.createElement('div');
    const chip = document.createElement('span');
    chip.className = 'pay-die pay-die--held';
    chip.dataset.id = 'c1';
    root.appendChild(chip);
    restoreInFlightHides(root);
    expect(chip.style.visibility).toBe('hidden');
    layer.remove();
  });
});
