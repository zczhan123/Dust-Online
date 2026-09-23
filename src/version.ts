declare const __APP_VERSION__: string;

/**
 * 应用版本号，唯一来源 = `package.json` 的 `version`（构建时由 `vite.config.ts` 注入 `__APP_VERSION__`）。
 * 测试/未注入环境兜底为 `'dev'`。
 */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

/** 展示用标签，如 `v0.1.0`（dev 时为 `vdev`）。 */
export const APP_VERSION_LABEL: string = `v${APP_VERSION}`;
