import { describe, it, expect } from 'vitest';
import { resetMotionRuntime, hasPendingAdds } from '../src/ui/motion';

describe('resetMotionRuntime???/????????', () => {
  it('?? fx ??????????', () => {
    const layer = document.createElement('div');
    layer.id = 'fx-layer';
    layer.innerHTML = '<div class="fx-die"></div><div class="fx-die"></div>';
    document.body.appendChild(layer);
    resetMotionRuntime();
    expect(document.getElementById('fx-layer')!.children.length).toBe(0);
    expect(hasPendingAdds()).toBe(false);
    layer.remove();
  });
});
