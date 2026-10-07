import type { NetMessage } from './protocol';
import type { Net } from './transport';
import { newPeerId } from './memory';

/**
 * 【WebSocket 中继】插头：连到本机（`scripts/relay.mjs`）或服务器上的中继。
 *
 * 与 `BroadcastNet` 的差别只有"能跨浏览器 / 跨机"；语义一致：
 * - 把消息发给**同频道其它端**（不回自己）；中继只做**转发**，不跑游戏逻辑。
 * - `peerId` 在**消息体内**（`from`），与底层连接无关 → 传输无关、会话层不感知。
 *
 * 断线重连**暂未做**（跨机重连依赖服务器 → 设计记录 §1 搁置）；连接断开后需重进大厅新建会话。
 */
export class WebSocketNet implements Net {
  readonly peerId = newPeerId();
  private ws: WebSocket;
  /** 连接建立前先攒着，open 后按序补发（避免开局握手丢消息） */
  private queue: NetMessage[] = [];
  private subs = new Set<(m: NetMessage) => void>();
  private closed = false;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      const q = this.queue;
      this.queue = [];
      for (const m of q) this.ws.send(JSON.stringify(m));
    };
    this.ws.onmessage = (e: MessageEvent) => {
      let msg: NetMessage;
      try {
        msg = JSON.parse(typeof e.data === 'string' ? e.data : String(e.data)) as NetMessage;
      } catch {
        return; // 非法帧忽略
      }
      for (const cb of this.subs) cb(msg);
    };
    this.ws.onerror = () => {
      /* 交给 onclose / 上层处理；此处只避免未捕获报错 */
    };
    this.ws.onclose = () => {
      /* 断线：暂不自动重连（见类注释） */
    };
  }

  send(msg: NetMessage): void {
    if (this.closed) return;
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else this.queue.push(msg);
  }

  onMessage(cb: (m: NetMessage) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  close(): void {
    this.closed = true;
    this.subs.clear();
    this.queue = [];
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}
