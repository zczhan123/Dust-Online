// 中继自检：验证「服务器 → 反向代理 → /ws → 中继」这条链路是否通。
//
// 在部署包里的位置：relay/check.mjs（和 relay.mjs 同一个目录，这样能找到 ws 依赖）
// 用法：
//   node relay/check.mjs ws://127.0.0.1:8787        ← 本机直连中继（先验中继本身）
//   node relay/check.mjs wss://你的域名/ws          ← 走 nginx/Caddy（验公网链路）
//
// 成功：打印「✓ 链路正常」并退出码 0
// 失败：打印排查提示并退出码 1
//
// 原理：开两个连接 A/B，A 发一条带随机标识的 hello，B 收到即说明
//       「握手（101）成功」+「中继双向转发正常」。
import { WebSocket } from 'ws';

const url = process.argv[2];
if (!url) {
  console.error('用法: node relay/check.mjs <ws地址>');
  console.error('  本机: ws://127.0.0.1:8787');
  console.error('  公网: wss://你的域名/ws');
  process.exit(2);
}

const probe = `probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const A = new WebSocket(url);
const B = new WebSocket(url);
let done = false;

const fail = (why) => {
  if (done) return;
  done = true;
  console.error(`✗ ${why}`);
  console.error('排查顺序：');
  console.error('  1) 中继起了吗：systemctl status dust-relay（或 pm2 status / 任务计划）');
  console.error('  2) 端口对吗：中继默认 8787；nginx/Caddy 里反代要指向同一个端口');
  console.error('  3) 反代带 WebSocket 头了吗：nginx 需要 Upgrade / Connection 两行（见 deploy/nginx.conf）');
  console.error('  4) 证书链对吗（wss 时）：浏览器能打开 https://你的域名/ 吗');
  try { A.terminate(); } catch {}
  try { B.terminate(); } catch {}
  process.exit(1);
};

const timer = setTimeout(() => fail('5 秒内没有完成"双端互发"'), 5000);
let aOpen = false;
let bOpen = false;
let sent = false;

const maybeSend = () => {
  if (aOpen && bOpen && !sent) {
    sent = true;
    A.send(JSON.stringify({ t: 'hello', probe }));
  }
};

A.on('open', () => { aOpen = true; maybeSend(); });
B.on('open', () => { bOpen = true; maybeSend(); });
B.on('message', (raw) => {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return; }
  if (msg && msg.probe === probe) {
    clearTimeout(timer);
    done = true;
    console.log(`✓ 链路正常：${url}`);
    console.log('  - 握手（101 Switching Protocols）：通');
    console.log('  - 中继 → 另一端（双向转发）：通');
    try { A.close(); } catch {}
    try { B.close(); } catch {}
    setTimeout(() => process.exit(0), 100);
  }
});
A.on('error', (e) => fail(`连不上 ${url}：${e?.message ?? e}`));
B.on('error', (e) => fail(`连不上 ${url}：${e?.message ?? e}`));
A.on('close', () => { if (!done) fail('连接 A 被关闭（反代/中继提前断开）'); });
B.on('close', () => { if (!done) fail('连接 B 被关闭（反代/中继提前断开）'); });
