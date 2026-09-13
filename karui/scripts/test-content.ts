import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const testFiles = async (directory: string) => {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter(entry => entry.isFile() && entry.name.endsWith('.test.ts'))
      .map(entry => join(directory, entry.name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
};

const files = await testFiles('content/tests');
try {
  for (const theme of await readdir('content/themes', { withFileTypes: true })) {
    if (theme.isDirectory()) files.push(...await testFiles(join('content/themes', theme.name, 'tests')));
  }
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

if (!files.length) {
  console.log('Brak dodatkowych testów w katalogu content.');
  process.exit(0);
}

files.sort((a, b) => a.localeCompare(b));
const child = spawn(process.execPath, ['--import', 'tsx', '--test', ...files], {
  env: process.env,
  stdio: 'inherit',
});

child.once('error', error => {
  console.error(error);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
