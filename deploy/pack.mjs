// 打「联机部署包」：vite build → 按服务器需要的目录结构复制 → 压成 zip
//
// 用法（在仓库根目录）：node deploy/pack.mjs
// 产物：delivery/dust-online/ + delivery/尘起时刻-联机部署.zip
//
// 说明：
// - 只读源码、只写 delivery/（以及重新生成构建产物 dist/）
// - **不改任何源码**；deploy/ 与 delivery/ 都是独立目录
// - 打包前请先确认三绿（tsc / vitest / vite build）并已提交版本
import { build } from 'vite';
import fs from 'node:fs';
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'delivery');
const stage = path.join(out, 'dust-online');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

console.log(`[pack] v${pkg.version}：vite build …`);
await build({ root, base: './', logLevel: 'warn' });

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

const copy = (from, to) => {
  // 注意：Windows + Node 24 上 `fs.cpSync` 偶发进程级崩溃（0xC0000409）→ 手写递归复制
  const walk = (src, dst) => {
    fs.mkdirSync(dst, { recursive: true });
    for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, ent.name);
      const d = path.join(dst, ent.name);
      if (ent.isDirectory()) walk(s, d);
      else fs.copyFileSync(s, d);
    }
  };
  const st = fs.statSync(from);
  if (st.isDirectory()) walk(from, to);
  else {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  console.log(`[pack] + ${path.relative(root, from)}  →  ${path.relative(stage, to) || '.'}`);
};

// 1) 网页（dist/ 的全部内容）
copy(path.join(root, 'dist'), path.join(stage, 'www'));

// 2) 中继 + ws 依赖（ws 无运行时依赖，随包带走 → 服务器零 npm install）
copy(path.join(root, 'scripts', 'relay.mjs'), path.join(stage, 'relay', 'relay.mjs'));
copy(path.join(root, 'node_modules', 'ws'), path.join(stage, 'relay', 'node_modules', 'ws'));
// 自检脚本放在中继旁边（这样 import 'ws' 能找到）
copy(path.join(root, 'deploy', 'check.mjs'), path.join(stage, 'relay', 'check.mjs'));

// 3) 部署配置
mkdirSync(path.join(stage, 'deploy'), { recursive: true });
for (const f of ['nginx.conf', 'nginx-https.conf', 'Caddyfile', 'dust-relay.service']) {
  copy(path.join(root, 'deploy', f), path.join(stage, 'deploy', f));
}

// 4) 说明文档（根目录一份，deploy/ 里一份）
copy(path.join(root, 'deploy', 'README-部署.md'), path.join(stage, 'README-部署.md'));
copy(path.join(root, 'deploy', 'README-部署.md'), path.join(stage, 'deploy', 'README-部署.md'));

// 5) 版本戳（方便排查群友装的是哪版）
writeFileSync(
  path.join(stage, 'VERSION.txt'),
  `尘起时刻 联机部署包 v${pkg.version}\n打包时间 ${new Date().toISOString()}\n`,
  'utf8',
);

// 6) 压缩
const zip = path.join(out, '尘起时刻-联机部署.zip');
rmSync(zip, { force: true });
try {
  if (process.platform === 'win32') {
    execFileSync(
      'powershell',
      ['-NoProfile', '-Command', `Compress-Archive -Path '${stage}' -DestinationPath '${zip}' -Force`],
      { stdio: 'inherit' },
    );
  } else {
    execFileSync('zip', ['-rq', zip, 'dust-online'], { cwd: out, stdio: 'inherit' });
  }
  console.log(`[pack] ✓ ${zip}`);
} catch (e) {
  console.warn(`[pack] 压缩失败（可手动压缩 delivery/dust-online）：${e?.message ?? e}`);
}

console.log('[pack] 下一步：把 zip 交给服务器管理员，按包内 README-部署.md 安装。');
