# 从源码构建与更新（给服务器管理员）

> 仓库为**公开仓库**：`git clone` / `git pull` 无需登录（只有向仓库推送代码才需要授权）。
> 本文档对应版本：`v0.34.3`（回滚也用它）。
> 如果只想快速上线、不想跑构建，直接用部署包（见 `deploy/README-部署.md`）；想以后一条命令更新，继续看本文。

## 0. 准备

1. **权限**：仓库是**公开**的，克隆/拉取**不需要**账号或令牌；只有需要向仓库推送代码时才要协作者权限（服务器管理员通常不需要）。
2. **环境**：
   - Git；
   - **Node.js 20 LTS**（或更高 LTS）；
   - 可选：nginx；`systemd`（Linux 服务器）。
3. **认证（可选）**：公开仓库读取无需认证；若你改成私有镜像或遇到限流，再用下面任一方式：
   - **HTTPS + PAT**：GitHub → Settings → Developer settings → Personal access tokens →
     细粒度令牌，权限仅勾选该仓库的 **内容：读取**；克隆时用户名填 GitHub 用户名、密码填 token。
   - **SSH**：把自己的公钥加到 GitHub → SSH keys，使用 `git@github.com:zczhan123/Dust-Online.git`。

## 1. 首次部署

```bash
sudo mkdir -p /opt/dust && sudo chown "$USER" /opt/dust
git clone https://github.com/zczhan123/Dust-Online.git /opt/dust/app
cd /opt/dust/app
npm ci                 # 按 package-lock.json 安装（含构建工具）
npm run build          # tsc + vite build → dist/
```

产物：

- 网页：`/opt/dust/app/dist/`（`index.html` + `assets/` + `cards/` 等）；
- 中继：`scripts/relay.mjs`（依赖 `ws`，已随 `npm ci` 安装）。

### nginx（站点根）

```nginx
server {
    listen 80;
    server_name 你的域名或IP;

    root /opt/dust/app/dist;
    index index.html;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    location = /index.html { add_header Cache-Control "no-store"; }
    location /assets/ { expires 30d; add_header Cache-Control "public, immutable"; }
    location /fonts/ { expires 30d; }

    location /ws {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location / { try_files $uri $uri/ /index.html; }
}
```

> 必须部署在**域名根路径**（不能放 `/dust/` 子目录）；HTTPS 需另行配置证书。

### 中继（systemd）

`/etc/systemd/system/dust-relay.service`：

```ini
[Unit]
Description=Dust Relay
After=network.target

[Service]
WorkingDirectory=/opt/dust/app
ExecStart=/usr/bin/node scripts/relay.mjs 8787
Restart=always
RestartSec=2
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now dust-relay
sudo systemctl status dust-relay --no-pager
```

自检（本机）：`node deploy/check.mjs ws://127.0.0.1:8787`（依赖 `ws`，`npm ci` 已安装）。
浏览器验收：大厅能建房、两个浏览器能互见房间并进入战斗。

## 2. 更新到新版本（一条命令）

```bash
cd /opt/dust/app
bash deploy/update.sh              # 跟随 master（推荐）
# 或锁定版本：
bash deploy/update.sh v0.34.3
```

脚本内部依次执行：`git fetch` → `git pull --ff-only`（或 checkout 指定 tag）→ `npm ci` → `npm run build` → 重启中继，
并**校验 `dist/assets` 里的版本号与 `package.json` 一致**；任何一步失败都会立即停止，不会留下"文件换了但网页还是旧版"的状态。

可用环境变量：`APP_DIR`（默认 `/opt/dust/app`）、`SERVICE`（默认 `dust-relay`）、
`SKIP_RESTART=1`（只更新不重启）、`CHECK_LINK=1`（顺带跑中继链路自检）。

- 静态页面由 nginx 直接读 `dist/`，无需 reload nginx；
- 通知玩家 **Ctrl+F5 / 手机硬刷新**（版本不一致会被大厅拒绝进入）；
- 验收：打开「关于游戏」，版本应为 **v0.34.3**。

## 3. 回滚

```bash
cd /opt/dust/app
bash deploy/update.sh v0.34.2     # 示例：回滚到上一个版本（任意旧 tag 均可）
```

## 4. 从压缩包模式迁移到源码模式（一次性）

如果你现在用的是部署包（`/opt/dust/www` + `/opt/dust/relay`），可以一次性改成源码模式；以后更新只需 `bash deploy/update.sh`。

> 前提：服务器能装 **Node.js 20**，且能访问 npm 源（`npm ci` 需要联网）。
> 迁移期间**先保留旧目录**，确认无误后再删，方便回滚。

1. 拉源码并构建（与现有 `www/relay` 并存，不动它们）：

```bash
sudo mkdir -p /opt/dust && sudo chown "$USER" /opt/dust
git clone https://github.com/zczhan123/Dust-Online.git /opt/dust/app
cd /opt/dust/app
git checkout v0.34.3
npm ci
npm run build
```

2. nginx：把站点 `root` 从 `/opt/dust/www` 改成 `/opt/dust/app/dist`（`/ws` 那段**保持不变**）：

```bash
# 配置文件路径按实际改（/etc/nginx/conf.d/、/etc/nginx/sites-enabled/ 或宝塔面板的站点配置）
sudo cp /etc/nginx/conf.d/你的站点.conf /etc/nginx/conf.d/你的站点.conf.bak.$(date +%s)
sudo sed -i 's#root /opt/dust/www;#root /opt/dust/app/dist;#' /etc/nginx/conf.d/你的站点.conf
sudo nginx -t && sudo systemctl reload nginx
```

3. 中继改用源码目录（`relay.mjs` 与部署包里是同一份代码）：

```ini
WorkingDirectory=/opt/dust/app
ExecStart=/usr/bin/node scripts/relay.mjs 8787
```

```bash
sudo systemctl daemon-reload
sudo systemctl restart dust-relay
```

4. 验收：

```bash
curl -s https://你的域名/ | grep -o 'assets/index-[^"]*\.js'
ls /opt/dust/app/dist/assets/index-*.js      # 文件名应与上一行一致
node deploy/check.mjs wss://你的域名/ws      # 应打印「✓ 链路正常」
```

浏览器打开「关于游戏」应为 **v0.34.3**。

5. 确认无误后再处理旧目录（回滚用，可保留几天）：

```bash
sudo mv /opt/dust/www /opt/dust/www.old
```

> 以后更新：`bash /opt/dust/app/deploy/update.sh`。

## 5. 常见问题

| 现象 | 处理 |
|---|---|
| `403` / 无法克隆 | 公开仓库一般不会；若你改成私有镜像，确认 PAT 勾了该仓库的 **内容：读取** 且未过期 |
| `npm ci` 报 lock 与 package.json 不一致 | 确认在仓库根目录、Node ≥ 20；必要时 `npm install` 后提交新的 lock（由作者处理） |
| 构建报 `tsc` 错误 | Node/TypeScript 版本不符；用 Node 20 LTS，`npm ci` 不要用 `--omit=dev` |
| 页面能开但联机一直“正在连接服务器” | nginx 少了 `Upgrade`/`Connection` 两行；或中继未启动 |
| 字体不是行书 | 站点不在**根路径**（字体走 `/fonts/`） |
| 玩家提示“版本不一致，请刷新” | 服务器 `dist/` 与玩家缓存不同：确认已重新构建 + 玩家硬刷新 |
| 「关于游戏」还是旧版本 | ① 没重新构建：`cd /opt/dust/app && npm run build`；② nginx 的 `root` 还指向旧目录（应为 `/opt/dust/app/dist`）；③ 玩家没硬刷新。用 `grep -o '"0\.3[0-9]\.[0-9]"' dist/assets/*.js` 确认产物版本 |
| 看到 `VERSION.txt` 是旧版本 | `VERSION.txt` 只是**压缩包标签**，不参与网页显示；线上版本以「关于游戏」或 `dist/assets` 里的版本为准 |

## 6. 说明

- **对局数据只在中继转发、不落库**；中继重启不影响已发出的消息语义，但会断开连接（前端会自动重连并请求状态快照）。
- 房间/身份 key 存在玩家浏览器本地（localStorage），清缓存视为换人。
- 卡图版权归原权利人，仅用于非商业同人用途。
