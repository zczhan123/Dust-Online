import { describe, it, expect } from 'vitest';
import { panelGlow } from '../src/ui/motion';

interface KF {
  boxShadow?: string;
  offset?: number;
}

const spyPanel = (acting = false) => {
  const panel = document.createElement('div');
  if (acting) panel.classList.add('player--acting');
  const frames: KF[][] = [];
  (panel as unknown as { animate: (kf: KF[]) => Animation }).animate = (kf: KF[]) => {
    frames.push(kf);
    return {} as Animation;
  };
  return { panel, frames };
};

const layers = (s?: string): number => (s ?? '').split('rgba(').length;

describe('面板彩光 · panelGlow（彩光期间黄框临时让位、随后淡回）', () => {
  it('无黄框：首/尾透明、中段＝传入 rgb；不含黄', () => {
    const { panel, frames } = spyPanel();
    panelGlow(panel, '192, 57, 43'); // 受伤红 #c0392b
    const [f0, mid, f1] = frames[0];
    expect(mid.boxShadow).toContain('rgba(192, 57, 43, 0.5)');
    expect(mid.boxShadow).not.toContain('242, 203, 92'); // 不含黄
    expect(f0.boxShadow).not.toContain('192, 57, 43'); // 首帧无彩光
    expect(f1.boxShadow).not.toContain('192, 57, 43'); // 尾帧无彩光
  });

  it('带 .player--acting：中段**不含黄**（临时让位）、首/尾＝黄框（回来）', () => {
    const { panel, frames } = spyPanel(true);
    panelGlow(panel, '29, 122, 77'); // 回血绿 #1d7a4d
    const [f0, mid, f1] = frames[0];
    expect(f0.boxShadow).toContain('rgba(242, 203, 92, .55)'); // 首帧是黄框
    expect(f1.boxShadow).toContain('rgba(242, 203, 92, .55)'); // 尾帧黄框回来
    expect(mid.boxShadow).toContain('rgba(29, 122, 77, 0.5)'); // 中段是绿光
    expect(mid.boxShadow).not.toContain('242, 203, 92'); // 中段黄没了
  });

  it('三个关键帧阴影层数一致（同形状 → 可插值）', () => {
    const a = spyPanel();
    panelGlow(a.panel, '192, 57, 43');
    expect(layers(a.frames[0][0].boxShadow)).toBe(layers(a.frames[0][1].boxShadow));

    const b = spyPanel(true);
    panelGlow(b.panel, '29, 122, 77');
    expect(layers(b.frames[0][0].boxShadow)).toBe(layers(b.frames[0][1].boxShadow));
  });
});
