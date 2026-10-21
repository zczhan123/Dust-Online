/**
 * 挑战模式「结算模式」小弹框：**选择界面三个药丸**与**战斗界面徽标**共用。
 * 文案唯一来源＝`content/challenges.ts` 的 `SETTLE_MODE_TEXT`。
 * 触发：桌面悬浮 / 右键（触屏长按）；战斗徽标额外支持"点击切换"（由调用方处理）。
 *
 * 触屏没有 `mouseleave`，所以额外做：
 * - **全局关闭**：点浮层/锚点以外、滚动、切后台；
 * - **4 秒自动收起**（兜底）。
 */
import { SETTLE_MODE_TEXT } from '../core/content/challenges';

export type SettleModeId = 'favor' | 'against' | 'manual';

let tipEl: HTMLDivElement | null = null;
let currentAnchor: HTMLElement | null = null;
let hideTimer: number | null = null;
let bound = false;

const AUTO_HIDE_MS = 4000;

function clearHideTimer(): void {
  if (hideTimer != null) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function bindGlobalDismiss(): void {
  if (bound) return;
  bound = true;
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (!tipEl || tipEl.hidden) return;
      const t = e.target as Node | null;
      if (t && (tipEl.contains(t) || (currentAnchor && currentAnchor.contains(t)))) return;
      hideSettleTip();
    },
    true,
  );
  window.addEventListener('scroll', () => hideSettleTip(), true);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hideSettleTip();
  });
}

function ensureTip(): HTMLDivElement {
  if (tipEl) {
    if (!tipEl.isConnected && typeof document !== 'undefined' && document.body) {
      document.body.appendChild(tipEl); // body 被重建/清空后自动挂回
    }
    return tipEl;
  }
  tipEl = document.createElement('div');
  tipEl.className = 'settle-tip';
  tipEl.setAttribute('role', 'tooltip');
  tipEl.hidden = true;
  document.body.appendChild(tipEl);
  bindGlobalDismiss();
  return tipEl;
}

/** 在 `anchor` 上方显示说明（空间不足自动翻到下方 / 贴边收进视口）。 */
export function showSettleTip(anchor: HTMLElement, mode: SettleModeId): void {
  const el = ensureTip();
  currentAnchor = anchor;
  clearHideTimer();
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
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => el.classList.add('settle-tip--on'));
  else el.classList.add('settle-tip--on');
  hideTimer = window.setTimeout(() => hideSettleTip(), AUTO_HIDE_MS);
}

export function hideSettleTip(): void {
  clearHideTimer();
  currentAnchor = null;
  if (!tipEl) return;
  tipEl.classList.remove('settle-tip--on');
  tipEl.hidden = true;
}

/** 给任意元素挂上"悬浮 / 右键（长按）显示说明"。返回解绑函数。 */
export function attachSettleTip(anchor: HTMLElement, mode: SettleModeId): () => void {
  const show = (): void => showSettleTip(anchor, mode);
  const hide = (): void => hideSettleTip();
  const onEnter = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return; // 触屏不靠 hover（没有 mouseleave，会卡住）
    show();
  };
  const onCtx = (e: Event): void => {
    e.preventDefault();
    show();
  };
  const onClick = (): void => {
    show(); // 触屏：点一下也显示（没有 hover 的兜底；4 秒后自动收起）
  };
  anchor.addEventListener('pointerenter', onEnter);
  anchor.addEventListener('pointerleave', hide);
  anchor.addEventListener('contextmenu', onCtx);
  anchor.addEventListener('click', onClick);
  return () => {
    anchor.removeEventListener('pointerenter', onEnter);
    anchor.removeEventListener('pointerleave', hide);
    anchor.removeEventListener('contextmenu', onCtx);
    anchor.removeEventListener('click', onClick);
  };
}
