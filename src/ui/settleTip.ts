/**
 * 挑战模式「结算模式」小弹框：**选择界面三个药丸**与**战斗界面徽标**共用。
 * 文案唯一来源＝`content/challenges.ts` 的 `SETTLE_MODE_TEXT`。
 * 触发：悬浮 / 右键（触屏长按）；战斗徽标额外支持"点击切换"（由调用方处理）。
 */
import { SETTLE_MODE_TEXT } from '../core/content/challenges';

export type SettleModeId = 'favor' | 'against' | 'manual';

let tipEl: HTMLDivElement | null = null;

function ensureTip(): HTMLDivElement {
  if (tipEl) return tipEl;
  tipEl = document.createElement('div');
  tipEl.className = 'settle-tip';
  tipEl.setAttribute('role', 'tooltip');
  tipEl.hidden = true;
  document.body.appendChild(tipEl);
  return tipEl;
}

/** 在 `anchor` 上方显示说明（空间不足自动翻到下方 / 贴边收进视口）。 */
export function showSettleTip(anchor: HTMLElement, mode: SettleModeId): void {
  const el = ensureTip();
  el.textContent = SETTLE_MODE_TEXT[mode];
  el.hidden = false;
  el.classList.remove('settle-tip--on');
  // 先量尺寸（hidden 时宽高为 0），再定位
  el.style.left = '0px';
  el.style.top = '0px';
  const a = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const gap = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = a.left + a.width / 2 - w / 2;
  left = Math.max(8, Math.min(vw - w - 8, left));
  let top = a.top - h - gap;
  if (top < 8) top = a.bottom + gap;
  if (top + h > vh - 8) top = Math.max(8, a.top - h - gap);
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
  requestAnimationFrame(() => el.classList.add('settle-tip--on'));
}

export function hideSettleTip(): void {
  if (!tipEl) return;
  tipEl.classList.remove('settle-tip--on');
  tipEl.hidden = true;
}

/** 给任意元素挂上"悬浮 / 右键（长按）显示说明"。返回解绑函数。 */
export function attachSettleTip(anchor: HTMLElement, mode: SettleModeId): () => void {
  const show = (): void => showSettleTip(anchor, mode);
  const hide = (): void => hideSettleTip();
  const onCtx = (e: Event): void => {
    e.preventDefault();
    show();
  };
  anchor.addEventListener('mouseenter', show);
  anchor.addEventListener('mouseleave', hide);
  anchor.addEventListener('contextmenu', onCtx);
  return () => {
    anchor.removeEventListener('mouseenter', show);
    anchor.removeEventListener('mouseleave', hide);
    anchor.removeEventListener('contextmenu', onCtx);
  };
}
