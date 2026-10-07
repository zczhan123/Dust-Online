import type { NetMessage } from './protocol';
import type { Net } from './transport';

let seq = 0;
/** 生成一个"端"的 id（仅在联机层用；**不影响引擎确定性**） */
export const newPeerId = (): string =>
  `p${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

/**
 * 同进程"总线"：一个端 `send` 会**异步**投递给**其它**所有端（模拟网络延迟，便于测试与调试）。
 * 用它可以把"两个玩家"放在同一进程里跑（单测 / 同页双端）。
 */
export class InMemoryBus {
  private handlers = new Map<string, (m: NetMessage) => void>();

  connect(peerId?: string): Net {
    const id = peerId ?? newPeerId();
    const bus = this;
    const net: Net = {
      peerId: id,
      send(msg: NetMessage): void {
        for (const [hid, h] of bus.handlers) {
          if (hid === id) continue; // 不回给自己
          queueMicrotask(() => h(msg));
        }
      },
      onMessage(cb: (m: NetMessage) => void): () => void {
        bus.handlers.set(id, cb);
        return () => {
          if (bus.handlers.get(id) === cb) bus.handlers.delete(id);
        };
      },
      close(): void {
        bus.handlers.delete(id);
      },
    };
    return net;
  }
}
