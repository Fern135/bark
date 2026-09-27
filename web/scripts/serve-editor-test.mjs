import { cp } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = process.env.BARK_BUILD_DIR || '.next';
const standalone = resolve(web, buildDir, 'standalone/web');
await cp(resolve(web, 'public'), resolve(standalone, 'public'), { recursive: true });
await cp(resolve(web, buildDir, 'static'), resolve(standalone, buildDir, 'static'), { recursive: true });
const server = spawn(process.execPath, ['server.js'], {
  cwd: standalone,
  stdio: 'inherit',
  env: { ...process.env, HOSTNAME: '127.0.0.1', PORT: process.env.BARK_TEST_PORT || '3101' },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
server.on('exit', code => { process.exitCode = code ?? 0; });
