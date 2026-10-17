// 联机中继（**按房间隔离**）：把消息只转发给"同一个房间"的连接；大厅类消息仍广播给所有人。
//
// 用法：node scripts/relay.mjs [port]      （默认 8787；或 npm run relay）
// 客户端：线上＝同源 `/ws`（nginx 反代到本程序）；LAN 临时测试可加 ?server=ws://<IP>:<port>
//
// 设计要点（对齐星杯/常见"大厅 + 房间"中继）：
// - 中继**不看业务内容**，只按消息里的 `roomId` 做**隔离**；
// - 连接属于哪个房间由这些消息建立/解除：
//   建立＝`room:announce`（房主开房/公告，取 room.id）/ `room:join` / `rejoin`
//   解除＝`room:leave` / `room:gone`（房主关房 → 清该房**所有**连接）/ 连接断开
// - **不在该房间的连接发来的"房间类"消息 → 直接丢弃**（防止房外的人冒名注入动作/聊天）；
// - 大厅类（`rooms:req` / `hello` / `hi` / `room:announce` / `room:gone`）→ 照旧广播给所有人。
import { WebSocketServer, WebSocket } from 'ws';
import { pathToFileURL } from 'node:url';

/** 大厅类：所有人可见（房间列表、在线名单、开房公告、关房通知） */
const LOBBY = new Set(['rooms:req', 'hello', 'hi', 'room:announce', 'room:gone']);

/**
 * 给一个 `WebSocketServer` 挂上"按房间隔离"的中继逻辑。
 * 导出以便**单测**（测试自己建 server，`node scripts/relay.mjs` 走文件末尾的自启动）。
 */
export function attachRelay(wss) {
  const send = (ws, raw) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(raw);
  };
  const broadcastAll = (from, raw) => {
    for (const c of wss.clients) if (c !== from) send(c, raw);
  };
  const forwardRoom = (from, roomId, raw) => {
    for (const c of wss.clients) {
      if (c !== from && c.roomId != null && c.roomId === roomId) send(c, raw);
    }
  };

  wss.on('connection', (ws) => {
    ws.roomId = null;
    ws.on('message', (data) => {
      const raw = data.toString();
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return; // 非法帧丢弃
      }
      const t = msg && typeof msg.t === 'string' ? msg.t : null;
      if (!t) return;
      const roomId = typeof msg.roomId === 'string' ? msg.roomId : null;

      // 1) 建立 / 解除"这条连接属于哪个房间"
      if (t === 'room:announce' && msg.room && typeof msg.room.id === 'string') {
        ws.roomId = msg.room.id; // 房主开房/公告
      } else if ((t === 'room:join' || t === 'rejoin') && roomId) {
        ws.roomId = roomId; // 加入 / 断线重连
      } else if (t === 'room:leave') {
        if (roomId) forwardRoom(ws, roomId, raw); // 先让房里的人知道
        ws.roomId = null;
        return;
      } else if (t === 'room:gone') {
        const dead = roomId ?? ws.roomId;
        if (dead) for (const c of wss.clients) if (c.roomId === dead) c.roomId = null;
      }

      // 2) 大厅类 → 广播给所有人
      if (LOBBY.has(t)) {
        broadcastAll(ws, raw);
        return;
      }

      // 3) 房间类 → 只给同房间；**发送者不属于该房间 → 丢弃**（防冒名注入）
      if (!roomId || ws.roomId !== roomId) return;
      forwardRoom(ws, roomId, raw);
    });
    ws.on('error', () => {});
  });
}

/** 自启动（被 `node scripts/relay.mjs` 直接运行时）：仅在"作为入口脚本"时执行，import 时不跑。 */
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.argv[2] ?? process.env.PORT ?? 8787);
  const wss = new WebSocketServer({ port });
  attachRelay(wss);
  wss.on('listening', () => {
    console.log(`[relay] 已启动（按房间隔离）：ws://localhost:${port}`);
    console.log('[relay] 线上：由 nginx 把 /ws 反代到本端口；LAN 测试：?server=ws://<IP>:<port>');
  });
  wss.on('error', (e) => {
    console.error(`[relay] 出错：${e?.message ?? e}`);
  });
}
