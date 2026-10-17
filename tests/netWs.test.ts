// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { WebSocketServer, WebSocket as WsServerWebSocket } from 'ws';
import { WebSocketNet } from '../src/net/ws';
import type { NetMessage } from '../src/net/protocol';
import type { NetStatus } from '../src/net/transport';

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

  it(
    '中继重启 → 客户端自动重连（第二次 open）；断线期间排队的消息在重连后补发（到中继）',
    async () => {
      /** 收到客户端消息即记一笔（供断言"重连后补发"），并按中继语义转发给其它端。 */
      const relayGot: string[] = [];
      const mkRelay = (wss: WebSocketServer): void => {
        wss.on('connection', (ws) => {
          ws.on('message', (data) => {
            const raw = data.toString();
            relayGot.push(raw);
            for (const c of wss.clients) {
              if (c !== ws && c.readyState === WsServerWebSocket.OPEN) c.send(raw);
            }
          });
        });
      };
      const wss1 = new WebSocketServer({ port: 0 });
      await new Promise<void>((r) => wss1.on('listening', () => r()));
      const port = (wss1.address() as { port: number }).port;
      mkRelay(wss1);

      const a = new WebSocketNet(`ws://localhost:${port}`);
      const b = new WebSocketNet(`ws://localhost:${port}`);
      const statuses: NetStatus[] = [];
      a.onStatus((s) => statuses.push(s));
      const gotB: NetMessage[] = [];
      b.onMessage((m) => gotB.push(m));
      await until(() => statuses.includes('open'));

      // 杀掉中继（两端都断）
      for (const c of wss1.clients) c.terminate();
      await new Promise<void>((r) => wss1.close(() => r()));
      await until(() => statuses.includes('reconnecting'));

      // 断线期间发一条 → 入队（此时发不出去）
      relayGot.length = 0;
      a.send({ t: 'hello', from: a.peerId, name: '甲' });
      expect(relayGot).toEqual([]);

      // 同端口重启中继
      const wss2 = new WebSocketServer({ port });
      await new Promise<void>((r) => wss2.on('listening', () => r()));
      mkRelay(wss2);

      await until(() => statuses.filter((s) => s === 'open').length >= 2, 20000);
      expect(statuses.filter((s) => s === 'open').length).toBeGreaterThanOrEqual(2);
      // 重连后队列补发 → 中继收到那条（对端此刻是否已回来无关紧要；对局靠 rejoin+snapshot 恢复）
      await until(() => relayGot.some((s) => s.includes('"hello"')), 20000);
      expect(relayGot.some((s) => s.includes('"hello"'))).toBe(true);

      a.close();
      b.close();
      await new Promise<void>((r) => wss2.close(() => r()));
    },
    60000,
  );
});
