// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { WebSocketServer, WebSocket as WsServerWebSocket } from 'ws';
import { WebSocketNet } from '../src/net/ws';
import type { NetMessage } from '../src/net/protocol';

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean, timeout = 15000): Promise<void> => {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < timeout) await wait(10);
};

describe('联机 · WebSocketNet（连中继 → 跨端转发，等价 BroadcastChannel 语义）', () => {
  it(
    '一端 send → 中继广播给另一端（不回自己）；连接建立前 send 会先入队',
    async () => {
    const wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((r) => wss.on('listening', () => r()));
    const port = (wss.address() as { port: number }).port;
    // 中继逻辑与 scripts/relay.mjs 一致：转发给其它所有端
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        for (const c of wss.clients) {
          if (c !== ws && c.readyState === WsServerWebSocket.OPEN) c.send(data.toString());
        }
      });
    });

    const a = new WebSocketNet(`ws://localhost:${port}`);
    const b = new WebSocketNet(`ws://localhost:${port}`);
    const gotA: NetMessage[] = [];
    const gotB: NetMessage[] = [];
    a.onMessage((m) => gotA.push(m));
    b.onMessage((m) => gotB.push(m));

    // 连接尚未建立时 send → 入队，open 后补发
    const msg: NetMessage = { t: 'hello', from: a.peerId, name: '甲' };
    a.send(msg);
    await until(() => gotB.length === 1);
    expect(gotB).toEqual([msg]);
    expect(gotA).toEqual([]); // 不回给自己

    // B 回一条 → A 收到
    const reply: NetMessage = { t: 'hi', from: b.peerId, name: '乙' };
    b.send(reply);
    await until(() => gotA.length === 1);
    expect(gotA).toEqual([reply]);

    a.close();
    b.close();
    await new Promise<void>((r) => wss.close(() => r()));
  }, 30000);
});
