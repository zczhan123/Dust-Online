import { defineConfig } from 'vite';
import pkg from './package.json';

export default defineConfig({
  // 把 package.json 的 version 注入为全局常量（唯一版本来源），供首页右下角显示
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: {
    globals: true,
    environment: 'jsdom',
  },
});
