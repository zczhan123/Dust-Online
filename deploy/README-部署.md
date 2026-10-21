# 尘起时刻 · 联机版 · 部署说明

> 面向：服务器管理员（群友）。照着做即可，**不需要懂前端**。
> 一句话原理：这是一个**纯静态网页** + 一个**极小的中继程序**（只转发消息，不存数据、不存回放）。没有数据库，**也不需要 `npm install`**（依赖已随包附带）。

---

## 0. 包里有什么

```
dust-online/
├─ README-部署.md          ← 本文件
├─ VERSION.txt             ← 版本号 + 打包时间（排查问题先看它）
├─ www/                    ← 网页（给 nginx/Caddy 托管）
├─ relay/
│  ├─ relay.mjs            ← 联机中继（Node 程序）
│  ├─ check.mjs            ← 自检脚本
│  └─ node_modules/ws/     ← 依赖（已附带，无需安装）
└─ deploy/
   ├─ nginx.conf           ← 路线甲：IP + http
   ├─ nginx-https.conf     ← 路线乙：域名 + https
   ├─ Caddyfile            ← 备选：Caddy（自动证书）
   └─ dust-relay.service   ← 中继常驻服务（systemd）
```

> `www/fonts/` 内是 **2 个行草字体子集**（`zhimangxing-subset*.woff2`）；更新版本时不要漏拷该目录（漏了字体会回退成系统字体）。

**唯一要求**：Node.js **≥ 18**；以及 nginx **或** Caddy 二选一。

---

## 1. 先查环境（30 秒）

```bash
cat /etc/os-release        # 看发行版：Debian/Ubuntu 用 apt；CentOS/Rocky/Alma 用 dnf
node -v                    # 需要 v18 或更高；没有就装（见下）
command -v nginx           # 有输出 = 已装 nginx
command -v caddy           # 有输出 = 已装 Caddy
```

**没有 / 版本太低？** 装 Node 20 LTS：

```bash
# Debian / Ubuntu
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs unzip

# CentOS / Rocky / RHEL
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs unzip
```

> 如果 Node 是用 **nvm** 装的：后面 `dust-relay.service` 里的 `ExecStart` 路径要用 `command -v node` 的结果替换（nvm 的 node 不在 `/usr/bin/node`）。

---

## 2. 选路线（看有没有域名 + 证书）

| | 路线甲（最快跑起来） | 路线乙（正式） |
|---|---|---|
| 访问方式 | `http://服务器IP/` | `https://你的域名/` |
| 联机连接 | `ws://`（明文） | `wss://`（加密） |
| 需要 | 无 | 域名 + 证书 |
| 配置 | `deploy/nginx.conf` | `deploy/nginx-https.conf` 或 `deploy/Caddyfile` |
| 建议 | 先内测 | 对外用这个；也可以先甲，之后随时升级到乙 |

> 两种路线**其余步骤完全一样**（解压、起中继、防火墙、自检）。

---

## 3. 解压到 `/opt/dust`

```bash
# 假设 zip 传到了家目录
sudo mkdir -p /opt
sudo unzip -o ~/尘起时刻-联机部署.zip -d /opt
sudo mv /opt/dust-online /opt/dust

# 让 nginx / 中继能读
sudo chmod -R a+rX /opt/dust
```

解压后应看到 `/opt/dust/www/index.html`、`/opt/dust/relay/relay.mjs`。

---

## 4. 起中继（systemd 常驻）

```bash
sudo cp /opt/dust/deploy/dust-relay.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dust-relay
systemctl status dust-relay          # 应显示 active (running)
```

**按你的系统改两处**（改完 `sudo systemctl daemon-reload && sudo systemctl restart dust-relay`）：

1. `ExecStart=/usr/bin/node relay.mjs 8787` —— 用 `command -v node` 的输出替换 `/usr/bin/node`。
2. `User=www-data` —— Debian/Ubuntu 保持；CentOS/RHEL 改成 `nginx`。

看日志：`journalctl -u dust-relay -f`

---

## 5. 配置 nginx

### 5.1 放配置文件

```bash
# Debian / Ubuntu（sites-available 结构）
sudo cp /opt/dust/deploy/nginx.conf /etc/nginx/sites-available/dust
sudo ln -sf /etc/nginx/sites-available/dust /etc/nginx/sites-enabled/dust

# CentOS / Rocky
sudo cp /opt/dust/deploy/nginx.conf /etc/nginx/conf.d/dust.conf
```

> **如果这台 nginx 还在给别的站点用**：把配置里的 `server_name _;` 改成你的域名（路线乙必须），避免抢 80 端口。

### 5.2 路线甲（http）

保持 `deploy/nginx.conf` 原样（`server_name _;` 即可），然后：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 5.3 路线乙（https）

1. 域名 A 记录指向本机 IP（先确认 `ping 你的域名` 是这台机器）。
2. 把 `deploy/nginx-https.conf` 复制过去（同 5.1 的路径），并改两处：
   - 所有 `example.com` → 你的域名
   - 证书路径 → 你的实际证书（下面用 certbot 的话它会自动改好）
3. 申请证书并自动改配置：

```bash
# Debian / Ubuntu
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d 你的域名
# CentOS / Rocky
sudo dnf install -y certbot python3-certbot-nginx
sudo certbot --nginx -d 你的域名
```

4. 验证自动续期：`sudo certbot renew --dry-run`

### 5.4 备选：Caddy（不想用 nginx）

```bash
sudo cp /opt/dust/deploy/Caddyfile /etc/caddy/Caddyfile   # 先把 example.com 改成你的域名
sudo systemctl reload caddy
```
Caddy 会自动申请/续期证书。之后**不要**再让 nginx 占 80/443。

---

## 6. 防火墙（重要）

只放行 **80 / 443**；**8787 不要对外**（它只给本机 nginx 反代用）：

```bash
# ufw（Debian/Ubuntu）
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# firewalld（CentOS/Rocky）
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

**云服务器**还要在控制台「安全组」放行 80/443（这一步最容易漏）。

---

## 7. 自检（装完立刻做）

```bash
# 1) 中继本身（不经过 nginx）
node /opt/dust/relay/check.mjs ws://127.0.0.1:8787

# 2) 完整链路（经过 nginx/Caddy）
node /opt/dust/relay/check.mjs ws://你的IP/ws          # 路线甲
node /opt/dust/relay/check.mjs wss://你的域名/ws        # 路线乙
```

看到 `✓ 链路正常` 即通。失败时脚本会打印排查顺序（中继没起 / 端口不对 / 反代缺 WebSocket 头 / 证书问题）。

再确认网页：`curl -I https://你的域名/`（或 `http://你的IP/`）应返回 `200`。

---

## 8. 浏览器验收（6 项，每项一句话"看到什么算对"）

> 用**两个不同浏览器**（或一台电脑 + 一部手机）测；同一浏览器两个标签会共用身份，测不出问题。

| # | 操作 | 算对的样子 |
|---|---|---|
| 1 | 打开首页 | 封面正常；菜单字是**行书**（不是系统宋体） |
| 2 | A 开房 → B 看到房间并加入 | 两边都进入战斗界面 |
| 3 | 聊天 | 双方消息互见；名字 A 蓝 / B 红；对方来消息有数字药丸 |
| 4 | B 按 F5 刷新 | 自动回到对局；A 那侧先显示"正在重连…"再恢复；**不出现**"对方已退出（本局作废）" |
| 4b | B **关掉标签**，再开新标签进联机大厅 | 大厅出现「**继续对局（上次的房间已失联，尝试重连）**」；点击后回到原局；A 侧**不出现**"对方已掉线"误报；聊天历史 / 倒计时 / 战报都在 |
| 4c | A（房主）**关掉标签**，再开新标签进大厅 | 同上（**房主也能回来**）；回来后房间重新出现在大厅、旁观按钮正常 |
| 4d | 已在对局中的人点「旁观」 | 被拦下并提示"你还在本局中，不能旁观自己的对局" |
| 5 | 第三个浏览器点「旁观」 | 只读：能点玩家面板切视角、没有聊天输入框；关掉旁观**不影响** A/B；**掷完初始骰子（初始重掷阶段）** 就应看到「旁观」按钮 |
| 6 | A 踢人（只移出） | 被踢方回大厅；"移出并拉黑"后再进会被拒，且只有他被拒（A 和旁观者不受影响） |

6 项都 OK = 部署完成。

---

## 9. 更新版本

1. 拿到新的 zip，解压到临时目录，**替换** `/opt/dust/www/`（整目录替换，别只覆盖一层）。
2. `sudo systemctl restart dust-relay`（一般不用换中继，但一起重启最省心）。
3. **不用动 nginx 配置**。
4. 通知玩家刷新页面（旧版本加入会被提示"版本不一致，请刷新"）。

---

## 10. 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 打开显示 **502 Bad Gateway** | 中继没起：`systemctl status dust-relay`；看 `journalctl -u dust-relay -n 50` |
| 页面 **403 Forbidden** | 目录权限：`sudo chmod -R a+rX /opt/dust/www` |
| 菜单字体不是行书 | 没部署在**根路径**。必须 `https://域名/`，不能放 `https://域名/dust/`（字体走 `/fonts/`） |
| 白屏 / 控制台 404 | 同上：确认 `www/` 内容在站点根；`base:'./'` 已处理相对路径 |
| 一直"正在连接服务器" | 跑第 7 节自检；最常见是 nginx 反代少了 `Upgrade`/`Connection` 两行 |
| 自检报 101 失败（wss） | 证书链/域名不匹配；先确认浏览器能打开 `https://域名/` |
| "版本不一致，请刷新" | 服务器文件和玩家缓存不同：重新部署 + 让玩家 Ctrl+F5 |
| 局域网能玩、外网不行 | 云服务器**安全组**没放行 80/443（放行后不用管 8787） |
| 8787 端口被占用 | 改 `dust-relay.service` 里的 `8787`，并同步改 nginx/Caddy 的 `proxy_pass` |
| 中继反复重启 | 看 `journalctl -u dust-relay`；多为路径/权限/端口问题 |
| 联机行为异常（掉线提示 / 重连 / 旁观 / 战报） | 网址后加 **`?diag=1`** → 打开设置面板「诊断日志」→ 一键复制，附给排查者 |
| 掉线后在大厅看不到原房间 | 房主掉线后房间不再广播：用列表里的「**继续对局（上次的房间已失联，尝试重连）**」入口 |

---

## 11. 限制与说明（请如实告知玩家）

- **没有账号系统**：进入即用；"黑名单"只记在**房主本机浏览器**里，清缓存/换浏览器即失效（只防手滑，不防恶意）。
- **聊天是明文**：服务器管理员技术上能看到经过服务器的消息内容。朋友局可接受。
- **不存任何对局数据**：中继只转发；没有回放/存档；房间清空即无。
- **断线重连**：刷新 / 关标签后，在联机大厅点「**继续对局**」可回到原局（房主、访客均支持）；掉线后有约 **60 秒**宽限倒计时，超时会提示回大厅重开。
- **双方同时关闭浏览器 → 对局无法恢复**（中继不存对局，局面只在两端内存里）。
- **换浏览器 / 换设备不能重连**（身份 key 存在本机 localStorage）。
- 房主掉线时房间会**从大厅列表消失**，回来时走上面说的「继续对局」入口。
- **一台服务器一份中继即可**：多房间共用（按房间隔离，互不串台）。
- **必须部署在域名根路径**（原因见上表）。
- **房间密码**：建房时可设 4 位数字密码，加入与旁观都要输入；密码只存在房主内存/本地记录，随消息只传"有密码"标记（明文经中继，**仅防手滑，不是加密**）；断线重连不重新要密码。
- **手机适配**：页面已加 viewport，手机断点生效（单列/可横滑/按真实高度缩放）；不锁定横竖屏，跟随系统。
- 浏览器：Chrome / Edge / Firefox / Safari 近两年版本；手机可用但界面以桌面为主。

---

## 12. 路径与端口一览

| 项 | 值 |
|---|---|
| 网页目录 | `/opt/dust/www` |
| 中继目录 | `/opt/dust/relay` |
| 中继监听 | `8787`（所有网卡；**必须用防火墙挡住，不要对外**） |
| 对外端口 | 80（路线甲）/ 443（路线乙） |
| 反代路径 | `/ws` → `http://127.0.0.1:8787` |
| 服务名 | `dust-relay` |
| 版本 | 见 `VERSION.txt` |
