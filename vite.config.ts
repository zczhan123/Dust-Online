import { defineConfig } from 'vite';
import pkg from './package.json';

// 每次构建 / 每次启动 dev 都唯一的"构建标识"：联机**兼容校验**用。
// 比语义版本更严——只要代码变过（哪怕没涨版本号），标识必不同，杜绝"同版本号不同构建→静默分叉"。
const buildId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export default defineConfig({
  // 把 package.json 的 version 注入为全局常量（唯一版本源，用于页面角落展示）
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify(buildId),
  },
  test: {
    globals: true,
    environment: 'jsdom',
  },
});
