import type { NetMessage } from './protocol';
import type { Net, NetStatus } from './transport';
import { newPeerId } from './memory';

/** 重连退避：基础 1s、封顶 15s（第 n 次等待＝1s·2^(n−1)，±20% 抖动）。 */
export const RECONNECT_BASE_MS = 1000;
export const RECONNECT_MAX_MS = 15000;

/** 第 `attempt` 次（从 1 开始）重连前要等多久。**纯函数**，便于单测。 */
export function backoffMs(attempt: number, rand: () => number = Math.random): number {
  const raw = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.max(0, attempt - 1));
  const jitter = raw * 0.2;
  return Math.round(raw - jitter + rand() * jitter * 2);
}

/**
 * 【WebSocket 中继】插头：连到 `scripts/relay.mjs`（本机）或服务器上的中继。
 *
 * 与 `BroadcastNet` 的差别只有"能跨浏览器 / 跨机"；语义一致：
 * - 把消息发给**同频道其它端**（不回自己）；中继只做**转发**，不跑游戏逻辑。
 * - `peerId` 在**消息体内**（`from`），与底层连接无关 → 传输无关、会话层不感知。
 *
 * **断线自动重连**（2026-10-15）：非主动关闭时按指数退避重连；重连成功后由**会话层**
 * 自动补发 `rejoin`（由对端回 `snapshot`），玩家不必刷新页面。
 * 连接断开期间 `send()` 的消息先入队，重连后按序补发。
 *
 * 中文：断线后自动重连；主动 `close()` 不重连。
 */
export class WebSocketNet implements Net {
  readonly peerId = newPeerId();
  private readonly url: string;
  private readonly Ctor: typeof WebSocket;
  private ws: WebSocket;
  private queue: NetMessage[] = [];
  private subs = new Set<(m: NetMessage) => void>();
  private statusSubs = new Set<(s: NetStatus) => void>();
  /** 主动关闭（`close()`）→ 不再重连 */
  private closedManual = false;
  /** 已失败的重连次数（连接成功清零） */
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(url: string, opts?: { WebSocket?: typeof WebSocket }) {
    this.url = url;
    this.Ctor = opts?.WebSocket ?? WebSocket;
    this.ws = this.open();
  }

  /** 建立一条连接并挂好回调（首次连接与每次重连共用）。 */
  private open(): WebSocket {
    const ws = new this.Ctor(this.url);
    ws.onopen = () => {
      if (this.closedManual) return;
      this.attempt = 0;
      const q = this.queue;
      this.queue = [];
      for (const m of q) ws.send(JSON.stringify(m));
      this.emitStatus('open');
    };
    ws.onmessage = (e: MessageEvent) => {
      let msg: NetMessage;
      try {
        msg = JSON.parse(typeof e.data === 'string' ? e.data : String(e.data)) as NetMessage;
      } catch {
        return; // 非法帧忽略
      }
      for (const cb of this.subs) cb(msg);
    };
    ws.onerror = () => {
      /* 交给 onclose / 上层处理；此处只避免未捕获报错 */
    };
    ws.onclose = () => {
      if (this.closedManual) {
        this.emitStatus('closed');
        return;
      }
      // 非主动关闭 → 退避重连（连不上就继续退避，直到手动关闭）
      this.attempt += 1;
      this.emitStatus('reconnecting');
      this.timer = setTimeout(() => {
        this.timer = null;
        if (this.closedManual) return;
        this.ws = this.open();
      }, backoffMs(this.attempt));
    };
    return ws;
  }

  private emitStatus(s: NetStatus): void {
    for (const cb of this.statusSubs) cb(s);
  }

  send(msg: NetMessage): void {
    if (this.closedManual) return;
    if (this.ws.readyState === this.Ctor.OPEN) this.ws.send(JSON.stringify(msg));
    else this.queue.push(msg); // 未连上（含重连中）→ 入队，open 后补发
  }

  onMessage(cb: (m: NetMessage) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  onStatus(cb: (s: NetStatus) => void): () => void {
    this.statusSubs.add(cb);
    return () => this.statusSubs.delete(cb);
  }

  close(): void {
    this.closedManual = true;
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.subs.clear();
    this.statusSubs.clear();
    this.queue = [];
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}
