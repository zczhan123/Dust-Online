# 从源码构建与更新（给服务器管理员）

> 仓库为**私有仓库**，需要被加为 **Collaborator** 才能拉取。
> 本文档对应版本：`v0.34.2`（回滚也用它）。
> 如果只想快速上线、不想跑构建，直接用部署包（见 `deploy/README-部署.md`）。

## 0. 准备

1. **权限**：仓库作者在 GitHub → Settings → Collaborators 里把你的 GitHub 账号加为协作者。
2. **环境**：
   - Git；
   - **Node.js 20 LTS**（或更高 LTS）；
   - 可选：nginx；`systemd`（Linux 服务器）。
3. **认证（二选一）**：
   - **HTTPS + PAT**：GitHub → Settings → Developer settings → Personal access tokens →
     Fine-grained token，权限仅勾选该仓库的 **Contents: Read**；克隆时用户名填 GitHub 用户名、密码填 token。
   - **SSH**：把自己的公钥加到 GitHub → SSH keys，使用 `git@github.com:zczhan123/-Dust-Online.git`。

## 1. 首次部署

```bash
sudo mkdir -p /opt/dust && sudo chown "$USER" /opt/dust
git clone https://github.com/zczhan123/-Dust-Online.git /opt/dust/app
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

## 2. 更新到新版本

```bash
cd /opt/dust/app
git fetch --tags --prune
git checkout <新 tag，如 v0.34.2>      # 或 git pull --ff-only（跟随 master）
npm ci                                  # 依赖有变化时必须执行
npm run build
sudo systemctl restart dust-relay
```

- 静态页面由 nginx 直接读 `dist/`，无需 reload nginx；
- 通知玩家 **Ctrl+F5 / 手机硬刷新**（版本不一致会被大厅拒绝进入）。

## 3. 回滚

```bash
cd /opt/dust/app
git checkout v0.34.2     # 或上一个可用 tag
npm ci
npm run build
sudo systemctl restart dust-relay
```

## 4. 常见问题

| 现象 | 处理 |
|---|---|
| `403` / 私有仓库无法克隆 | 未被加为 Collaborator；或 PAT 无该仓库 Contents: Read；或 token 过期 |
| `npm ci` 报 lock 与 package.json 不一致 | 确认在仓库根目录、Node ≥ 20；必要时 `npm install` 后提交新的 lock（由作者处理） |
| 构建报 `tsc` 错误 | Node/TypeScript 版本不符；用 Node 20 LTS，`npm ci` 不要用 `--omit=dev` |
| 页面能开但联机一直“正在连接服务器” | nginx 少了 `Upgrade`/`Connection` 两行；或中继未启动 |
| 字体不是行书 | 站点不在**根路径**（字体走 `/fonts/`） |
| 玩家提示“版本不一致，请刷新” | 服务器 `dist/` 与玩家缓存不同：确认已重新构建 + 玩家硬刷新 |

## 5. 说明

- **对局数据只在中继转发、不落库**；中继重启不影响已发出的消息语义，但会断开连接（前端会自动重连并请求状态快照）。
- 房间/身份 key 存在玩家浏览器本地（localStorage），清缓存视为换人。
- 卡图版权归原权利人，仅用于非商业同人用途。
