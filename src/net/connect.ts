import type { Net } from './transport';
import { BroadcastNet } from './broadcast';
import { WebSocketNet } from './ws';

/**
 * 解析"该用哪个传输"（**唯一收口**）。
 * - 网址带 `?server=ws://…` / `?server=wss://…` → 返回该地址（走 WebSocket 中继）；
 * - 其它（含空、非 ws/wss 协议）→ 返回 `null`（走同机双标签 `BroadcastChannel`）。
 *
 * 纯函数，便于单测。
 */
export function resolveNetUrl(search: string): string | null {
  const s = (new URLSearchParams(search).get('server') ?? '').trim();
  return /^wss?:\/\//i.test(s) ? s : null;
}

/**
 * 创建传输——**"用哪个传输"只在这里决定**。
 *
 * - 缺省：`BroadcastNet`（同机双标签，零依赖；开发 / 本地验证）。
 * - 配了 `?server=ws://…`：`WebSocketNet`（连本机中继或服务器 → 可跨浏览器 / 跨机）。
 *
 * 将来上生产：改这里（或让部署时注入地址）即可，**上层（会话 / 界面）一行不动**。
 */
export function createNet(
  search: string = typeof window !== 'undefined' ? window.location.search : '',
): Net {
  const url = resolveNetUrl(search);
  return url ? new WebSocketNet(url) : new BroadcastNet('dust-online');
}
