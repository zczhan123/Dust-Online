// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
// scripts/ 不在 tsconfig 的 include 里（纯 node 脚本，无类型声明）→ 显式忽略解析错误
// @ts-expect-error 见上
import { attachRelay } from '../scripts/relay.mjs';

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean, timeout = 8000): Promise<void> => {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < timeout) await wait(10);
};

interface Client {
  ws: WebSocket;
  got: unknown[];
}

async function startRelay(): Promise<{
  port: number;
  connect: () => Promise<Client>;
  close: () => Promise<void>;
}> {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((r) => wss.on('listening', () => r()));
  attachRelay(wss);
  const port = (wss.address() as { port: number }).port;
  return {
    port,
    connect: async () => {
      const ws = new WebSocket(`ws://localhost:${port}`);
      const got: unknown[] = [];
      ws.on('message', (d) => got.push(JSON.parse(d.toString())));
      await new Promise<void>((r) => ws.once('open', () => r()));
      return { ws, got };
    },
    close: async () => {
      for (const c of wss.clients) c.terminate();
      await new Promise<void>((r) => wss.close(() => r()));
    },
  };
}

const send = (c: Client, obj: unknown): void => c.ws.send(JSON.stringify(obj));

describe('中继 · 按房间隔离', () => {
  it('A 房聊天只到 A 房；大厅消息仍全员可见', async () => {
    const relay = await startRelay();
    try {
      const aHost = await relay.connect();
      const aGuest = await relay.connect();
      const aSpec = await relay.connect(); // 观众
      const bHost = await relay.connect();
      const outsider = await relay.connect(); // 没进任何房间

      send(aHost, { t: 'room:announce', from: 'h1', room: { id: 'room-a' } });
      send(aGuest, { t: 'room:join', from: 'g1', roomId: 'room-a', role: 'guest' });
      send(aSpec, { t: 'room:join', from: 's1', roomId: 'room-a', role: 'spectator' });
      send(bHost, { t: 'room:announce', from: 'h2', room: { id: 'room-b' } });
      await wait(50);

      send(aHost, { t: 'chat', from: 'h1', roomId: 'room-a', text: 'HI' });
      await until(() => aGuest.got.length > 0 || bHost.got.length > 0);
      await wait(60);
      // A 房成员（含观众）收到；B 房与局外人收不到
      expect(aGuest.got.some((m) => (m as { t?: string }).t === 'chat')).toBe(true);
      expect(aSpec.got.some((m) => (m as { t?: string }).t === 'chat')).toBe(true);
      expect(bHost.got.some((m) => (m as { t?: string }).t === 'chat')).toBe(false);
      expect(outsider.got.some((m) => (m as { t?: string }).t === 'chat')).toBe(false);

      // 大厅消息（房间公告）→ 局外人也能看到
      send(bHost, { t: 'room:announce', from: 'h2', room: { id: 'room-b' } });
      await until(() => outsider.got.some((m) => (m as { t?: string }).t === 'room:announce'));
      expect(outsider.got.some((m) => (m as { t?: string }).t === 'room:announce')).toBe(true);
    } finally {
      await relay.close();
    }
  });

  it('未入房者的房间类消息（如 action）被丢弃；入房后正常转发', async () => {
    const relay = await startRelay();
    try {
      const aHost = await relay.connect();
      const outsider = await relay.connect();
      send(aHost, { t: 'room:announce', from: 'h1', room: { id: 'room-a' } });
      await wait(50);

      send(outsider, { t: 'action', from: 'x', roomId: 'room-a', action: { t: 'advance' } });
      await wait(120);
      expect(aHost.got.some((m) => (m as { t?: string }).t === 'action')).toBe(false);

      // 正常加入后即可转发
      send(outsider, { t: 'room:join', from: 'x', roomId: 'room-a', role: 'guest' });
      await wait(30);
      send(outsider, { t: 'action', from: 'x', roomId: 'room-a', action: { t: 'advance' } });
      await until(() => aHost.got.some((m) => (m as { t?: string }).t === 'action'));
      expect(aHost.got.some((m) => (m as { t?: string }).t === 'action')).toBe(true);
    } finally {
      await relay.close();
    }
  });

  it('room:gone（房主关房）→ 清该房所有映射；之后的房间消息不再转发', async () => {
    const relay = await startRelay();
    try {
      const aHost = await relay.connect();
      const aGuest = await relay.connect();
      send(aHost, { t: 'room:announce', from: 'h1', room: { id: 'room-a' } });
      send(aGuest, { t: 'room:join', from: 'g1', roomId: 'room-a', role: 'guest' });
      await wait(50);

      send(aHost, { t: 'room:gone', from: 'h1', roomId: 'room-a' });
      await wait(50);

      send(aGuest, { t: 'chat', from: 'g1', roomId: 'room-a', text: 'after-gone' });
      await wait(120);
      // 房主已被解除映射 → 收不到；房客自己也不回自己
      expect(aHost.got.some((m) => (m as { t?: string; text?: string }).text === 'after-gone')).toBe(false);
    } finally {
      await relay.close();
    }
  });

  it('room:leave 会先转发给同房、再解除映射', async () => {
    const relay = await startRelay();
    try {
      const aHost = await relay.connect();
      const aGuest = await relay.connect();
      send(aHost, { t: 'room:announce', from: 'h1', room: { id: 'room-a' } });
      send(aGuest, { t: 'room:join', from: 'g1', roomId: 'room-a', role: 'guest' });
      await wait(50);

      send(aGuest, { t: 'room:leave', from: 'g1', roomId: 'room-a' });
      await until(() => aHost.got.some((m) => (m as { t?: string }).t === 'room:leave'));
      expect(aHost.got.some((m) => (m as { t?: string }).t === 'room:leave')).toBe(true);

      // 离开后不再收到该房消息
      send(aHost, { t: 'chat', from: 'h1', roomId: 'room-a', text: 'x' });
      await wait(120);
      expect(aGuest.got.some((m) => (m as { t?: string }).t === 'chat')).toBe(false);
    } finally {
      await relay.close();
    }
  });
});
