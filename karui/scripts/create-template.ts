import { cp, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const engineRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contentRoot = resolve(process.env.CONTENT_DIR ?? './content');
const templatesRoot = join(contentRoot, 'templates');
let name = process.argv[2]?.trim() ?? '';

if (!name) {
  if (!process.stdin.isTTY) throw new Error('Podaj nazwę szablonu jako argument albo uruchom polecenie w terminalu.');
  const prompt = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  name = (await prompt.question('Nazwa nowego szablonu (małe litery, cyfry i myślniki): ')).trim();
  prompt.close();
}
if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name) || name === 'default') {
  throw new Error('Nazwa musi mieć od 1 do 64 znaków: małe litery, cyfry i myślniki. Nazwa default jest zarezerwowana.');
}

await mkdir(templatesRoot, { recursive: true, mode: 0o700 });
if ((await lstat(templatesRoot)).isSymbolicLink()) throw new Error('Katalog content/templates nie może być dowiązaniem symbolicznym.');
const target = join(templatesRoot, name);
try { await lstat(target); throw new Error(`Szablon ${name} już istnieje.`); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }

const staging = await mkdtemp(join(templatesRoot, '.pending-'));
try {
  await cp(join(engineRoot, 'templates'), join(staging, 'templates'), { recursive: true, errorOnExist: true });
  await rename(join(staging, 'templates', 'assets'), join(staging, 'assets'));
  const label = name.split('-').map(part => part[0]!.toUpperCase() + part.slice(1)).join(' ');
  await writeFile(join(staging, 'theme.json'), JSON.stringify({
    name: label,
    version: '1.0.0',
    description: 'Szablon utworzony na podstawie domyślnego motywu.',
  }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await rename(staging, target);
} finally {
  await rm(staging, { recursive: true, force: true });
}

const manifest = JSON.parse(await readFile(join(target, 'theme.json'), 'utf8')) as { name: string };
console.log(`Utworzono szablon ${manifest.name}: ${target}`);
