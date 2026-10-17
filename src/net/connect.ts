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

/** 页面位置（只取判断需要的最小集合；便于测试注入）。 */
export interface RelayLoc {
  hostname: string;
  protocol: string;
  /** 含端口（如 `example.com:8443`） */
  host: string;
}

const isLocalHost = (h: string): boolean =>
  h === '' || h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';

/**
 * 中继地址的**三级兜底**（返回 `null` ＝ 不连中继，走 BroadcastChannel）：
 * ① 显式 `?server=` ② 构建期 `VITE_RELAY_URL` ③ **非 localhost** → 同源 `ws(s)://<当前域名>/ws`。
 * localhost（开发）→ `null`（行为与以前一致）。
 *
 * 这样：**线上玩家点普通链接即可联机（零参数）**；开发不变；LAN 临时测试仍可用 `?server=`。
 */
export function resolveRelayUrl(search: string, loc: RelayLoc): string | null {
  const explicit = resolveNetUrl(search);
  if (explicit) return explicit;
  const env = String(import.meta.env?.VITE_RELAY_URL ?? '').trim();
  if (/^wss?:\/\//i.test(env)) return env;
  if (isLocalHost(loc.hostname)) return null;
  const proto = loc.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${loc.host}/ws`;
}

/**
 * 创建传输——**"用哪个传输"只在这里决定**。
 *
 * - 缺省：`BroadcastNet`（同机双标签，零依赖；开发 / 本地验证）。
 * - 配了 `?server=ws://…` / `VITE_RELAY_URL` / 部署在非 localhost 域名下 → `WebSocketNet`。
 *
 * 上层（会话 / 界面）一行不动。
 */
export function createNet(
  search: string = typeof window !== 'undefined' ? window.location.search : '',
  loc: RelayLoc = typeof window !== 'undefined'
    ? { hostname: window.location.hostname, protocol: window.location.protocol, host: window.location.host }
    : { hostname: '', protocol: 'http:', host: '' },
): Net {
  const url = resolveRelayUrl(search, loc);
  return url ? new WebSocketNet(url) : new BroadcastNet('dust-online');
}
