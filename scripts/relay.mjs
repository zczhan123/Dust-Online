// 本机中继（开发 / 测试用）：把任一连接发来的消息「广播」给其它所有连接。
// 语义与浏览器 BroadcastChannel 一致（单频道、不落盘、**不跑游戏逻辑**），只是能跨浏览器 / 跨机。
//
// 用法：node scripts/relay.mjs [port]      （默认 8787；或 npm run relay）
// 客户端：浏览器地址加 ?server=ws://<本机IP>:<port>  —— 本机测用 ws://localhost:8787
//
// 跨机测：在"房主那台机"跑本脚本；两台机都连 ws://<房主机局域网IP>:8787（房主机防火墙放行该端口）。
import { WebSocketServer, WebSocket } from 'ws';

const port = Number(process.argv[2] ?? process.env.PORT ?? 8787);
const wss = new WebSocketServer({ port });

function broadcast(senderWs, raw) {
  for (const client of wss.clients) {
    if (client === senderWs) continue;
    if (client.readyState === WebSocket.OPEN) client.send(raw);
  }
}

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    // 只做转发：不改内容、不解析业务（去掉可能的二进制帧差异，统一转成文本）
    broadcast(ws, data.toString());
  });
  ws.on('error', () => {});
});

wss.on('listening', () => {
  console.log(`[relay] 已启动：ws://localhost:${port}`);
  console.log(`[relay] 浏览器地址加：?server=ws://localhost:${port}`);
});

wss.on('error', (e) => {
  console.error(`[relay] 出错：${e?.message ?? e}`);
});
