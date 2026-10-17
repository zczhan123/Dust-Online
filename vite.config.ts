import { defineConfig } from 'vite';
import pkg from './package.json';

// 每次构建 / 每次启动 dev 都唯一的"构建标识"：联机**兼容校验**用。
// 比语义版本更严——只要代码变过（哪怕没涨版本号），标识必不同，杜绝"同版本号不同构建→静默分叉"。
const buildId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export default defineConfig({
  // 资源路径一律**相对**：产物既能在站点根目录、也能在子路径（如 `/dust/`）下运行。
  // ⚠️ 例外：`styles.css` 里字体用的是 `public/fonts/…` 的绝对 URL（Vite 不改写）→ 子路径部署时字体需另做。
  base: './',
  // 由 package.json 的 version 注入为全局常量（唯一版本源），供首页/关于处展示。
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify(buildId),
  },
  // 开发期把同源 `/ws` 代理到本机中继（`npm run relay`）→ 本地也能像线上一样"零参数"连中继。
  // 没有起中继时不影响本地玩法（游戏默认仍走 BroadcastChannel；只有显式 `?server=` 或非 localhost 才会连）。
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
  },
});
