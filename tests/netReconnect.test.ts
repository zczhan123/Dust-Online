import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketNet, backoffMs, RECONNECT_BASE_MS, RECONNECT_MAX_MS } from '../src/net/ws';
import { NetSession } from '../src/net/session';
import type { NetMessage } from '../src/net/protocol';
import type { NetStatus } from '../src/net/transport';

/** 可手动驱动的假 WebSocket（只实现 WebSocketNet 用到的那几个成员）。 */
class FakeWS {
  static OPEN = 1;
  static instances: FakeWS[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  closed = false;
  constructor(public url: string) {
    FakeWS.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }
  // —— 测试驱动 ——
  openNow(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  dropNow(): void {
    this.readyState = 3;
    this.onclose?.();
  }
  recv(m: NetMessage): void {
    this.onmessage?.({ data: JSON.stringify(m) } as MessageEvent);
  }
}

describe('自动重连 · 退避（backoffMs）', () => {
  it('1s→2s→4s→8s→封顶 15s（rand 取中值＝无抖动）', () => {
    const mid = (): number => 0.5;
    expect(backoffMs(1, mid)).toBe(RECONNECT_BASE_MS);
    expect(backoffMs(2, mid)).toBe(2000);
    expect(backoffMs(3, mid)).toBe(4000);
    expect(backoffMs(4, mid)).toBe(8000);
    expect(backoffMs(5, mid)).toBe(RECONNECT_MAX_MS); // 16000 → 封顶 15000
    expect(backoffMs(9, mid)).toBe(RECONNECT_MAX_MS);
  });

  it('抖动在 ±20% 内', () => {
    expect(backoffMs(1, () => 0)).toBe(800);
    expect(backoffMs(1, () => 1)).toBe(1200);
  });
});

describe('自动重连 · WebSocketNet', () => {
  beforeEach(() => {
    FakeWS.instances = [];
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('断线 → 退避后新建连接 → 状态 open/reconnecting；断线期间 send 入队、重连后补发', () => {
    const net = new WebSocketNet('ws://x/ws', { WebSocket: FakeWS as unknown as typeof WebSocket });
    const statuses: NetStatus[] = [];
    net.onStatus((s) => statuses.push(s));
    const ws1 = FakeWS.instances[0];
    ws1.openNow();
    expect(statuses).toEqual(['open']);

    ws1.dropNow(); // 服务器/网络断开
    expect(statuses).toEqual(['open', 'reconnecting']);

    net.send({ t: 'hello', from: net.peerId, name: '甲' }); // 断线期间 → 入队
    expect(ws1.sent).toEqual([]);

    vi.advanceTimersByTime(RECONNECT_MAX_MS); // 退避到点（1s±20%，用封顶值保证足够）→ 建新连接
    expect(FakeWS.instances).toHaveLength(2);
    const ws2 = FakeWS.instances[1];
    ws2.openNow();
    expect(statuses).toEqual(['open', 'reconnecting', 'open']);
    expect(ws2.sent).toHaveLength(1); // 队列补发
    net.close();
  });

  it('主动 close() → 不重连（不再新建连接）', () => {
    const net = new WebSocketNet('ws://x/ws', { WebSocket: FakeWS as unknown as typeof WebSocket });
    const ws1 = FakeWS.instances[0];
    ws1.openNow();
    net.close();
    vi.advanceTimersByTime(RECONNECT_MAX_MS * 3);
    expect(FakeWS.instances).toHaveLength(1);
  });
});

describe('自动重连 · 会话层：重连成功自动 rejoin', () => {
  /** 极简 Net 桩：只有 onStatus 由测试驱动，send 全部记录。 */
  function stubNet(): {
    net: {
      peerId: string;
      send: (m: NetMessage) => void;
      onMessage: (cb: (m: NetMessage) => void) => () => void;
      close: () => void;
      onStatus: (cb: (s: NetStatus) => void) => () => void;
    };
    sent: NetMessage[];
    emit: (s: NetStatus) => void;
  } {
    const sent: NetMessage[] = [];
    const statusCbs: Array<(s: NetStatus) => void> = [];
    const net = {
      peerId: 'p1',
      send: (m: NetMessage) => void sent.push(m),
      onMessage: () => () => {},
      close: () => {},
      onStatus: (cb: (s: NetStatus) => void) => {
        statusCbs.push(cb);
        return () => {};
      },
    };
    return { net, sent, emit: (s) => statusCbs.forEach((cb) => cb(s)) };
  }

  it('首次 open 不发；断线后 open（且已在房内）→ 只管发一条 rejoin', () => {
    FakeWS.instances = [];
    const { net, sent, emit } = stubNet();
    const sess = new NetSession(net as never, '甲');
    // 首次连接：尚未入房 → 不发 rejoin
    emit('open');
    expect(sent.filter((m) => m.t === 'rejoin')).toHaveLength(0);
    // 模拟"已在房内"（测试直接写会话状态）
    sess.state.roomId = 'room-x';
    sess.state.role = 'guest';
    emit('reconnecting');
    expect(sess.state.netStatus).toBe('reconnecting');
    emit('open'); // 重连成功
    const rejoins = sent.filter((m) => m.t === 'rejoin');
    expect(rejoins).toHaveLength(1);
    expect(rejoins[0]).toMatchObject({ from: 'p1', roomId: 'room-x', role: 'guest' });
  });
});
