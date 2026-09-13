import { readdir, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';

const pluginsRoot = resolve(process.env.CONTENT_DIR ?? './content', 'plugins');
for (const entry of await readdir(pluginsRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
  const directory = join(pluginsRoot, entry.name);
  const exists = async (file: string) => access(join(directory, file)).then(() => true, () => false);
  if (!await exists('package.json')) continue;
  const command = await exists('package-lock.json') ? 'ci' : 'install';
  console.log(`Installing dependencies: ${entry.name} (${command})`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn('npm', [command, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: directory, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`npm failed in ${entry.name}: ${code}`)));
  });
}
