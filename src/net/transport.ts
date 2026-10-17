import type { NetMessage } from './protocol';

/**
 * 底层传输接口：**只负责**"把一条消息发给同频道其它端 / 收其它端的消息"。
 *
 * 具体的"插头"实现：
 * - `InMemoryNet`（`./memory`）：同进程双端，供**单测**与"同页双端"调试；
 * - `BroadcastNet`（`./broadcast`）：同机双标签（浏览器自带 `BroadcastChannel`，零依赖）；
 * - `WebSocketNet`（`./ws`）：连本机中继（`scripts/relay.mjs`）或服务器 → **跨浏览器 / 跨机**。
 *   "该用哪个"只在 `./connect` 的 `createNet()` 一处决定（网址带 `?server=ws://…` 时走它）。
 *
 * 换插头**不改上层（会话 / 界面）**。
 */
/** 连接状态（只有"会断线"的传输才发；Broadcast/InMemory 不发） */
export type NetStatus = 'open' | 'closed' | 'reconnecting';

export interface Net {
  readonly peerId: string;
  /** 发给同频道**其它**端（不回给自己） */
  send(msg: NetMessage): void;
  /** 注册接收；返回取消订阅函数 */
  onMessage(cb: (msg: NetMessage) => void): () => void;
  close(): void;
  /**
   * 可选：连接状态回调（`open` / `reconnecting` / `closed`）。
   * 会话层据此显示"正在重连…"并在 `open` 后**自动补发 `rejoin`**（由对端回 `snapshot`）。
   */
  onStatus?(cb: (s: NetStatus) => void): () => void;
}
