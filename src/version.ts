declare const __APP_VERSION__: string;
declare const __APP_BUILD__: string;

/**
 * 应用版本号，唯一来源 = `package.json` 的 `version`（构建时由 `vite.config.ts` 注入 `__APP_VERSION__`）。
 * 测试/未注入环境兜底为 `'dev'`。
 */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

/** 展示用标签，如 `v0.1.0`（dev 时为 `vdev`）。 */
export const APP_VERSION_LABEL: string = `v${APP_VERSION}`;

/**
 * **构建标识**（每次构建/启动 dev 都唯一，`vite.config.ts` 注入 `__APP_BUILD__`）。
 * 用于联机**兼容校验**——比语义版本更严：只要代码变过，标识必不同，杜绝"同版本号不同构建→静默分叉"。
 */
export const APP_BUILD: string = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev';
