import type { NetMessage } from './protocol';
import type { Net } from './transport';
import { newPeerId } from './memory';

/**
 * 【同机双标签】插头：用浏览器自带的 `BroadcastChannel`。
 *
 * 只在"**同一浏览器、同一网址（同源）**"的标签/窗口之间通信：
 * - ✅ 同一浏览器 + 两个标签/窗口 → 能对战；
 * - ❌ 两个不同浏览器（Chrome+Edge）/ 两台电脑 → 通不了（那需要 WebSocket 中继，等服务器确定）。
 *
 * （若运行环境没有 `BroadcastChannel`，构造时会抛错——测试请用 `InMemoryBus`。）
 */
export class BroadcastNet implements Net {
  readonly peerId = newPeerId();
  private bc: BroadcastChannel;
  private subs = new Set<(m: NetMessage) => void>();

  constructor(channel = 'dust-online') {
    this.bc = new BroadcastChannel(channel);
    this.bc.onmessage = (e: MessageEvent) => {
      const msg = e.data as NetMessage;
      for (const cb of this.subs) cb(msg);
    };
  }

  send(msg: NetMessage): void {
    this.bc.postMessage(msg);
  }

  onMessage(cb: (m: NetMessage) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  close(): void {
    this.subs.clear();
    this.bc.close();
  }
}
