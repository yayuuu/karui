import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
// Run after npm run build. The runtime container already contains dist/.
// @ts-ignore The runtime import is produced by the build, not checked as source.
import { PanelFiles } from '../dist/admin/files.js';
// @ts-ignore See above.
import { hashPassword } from '../dist/admin/password.js';

const login = process.argv[2] ?? 'admin';
if (!/^[A-Za-z0-9_-]{1,48}$/.test(login)) throw new Error('Nieprawidłowy login.');
const files = new PanelFiles(resolve(process.env.CONTENT_DIR ?? './content'));
const path = 'state/panel/accounts.json';
try { await files.read(path); throw new Error('Konta już istnieją. Zmieniaj je przez panel; inicjalizator nie nadpisuje istniejących kont.'); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
let password = '';
if (process.stdin.isTTY) {
  let muted = false;
  const output = new Writable({ write(chunk, _encoding, done) { if (!muted) process.stdout.write(chunk); done(); } });
  const prompt = createInterface({ input: process.stdin, output, terminal: true });
  process.stdout.write('Hasło nowego administratora (min. 8 znaków): '); muted = true;
  password = await prompt.question('');
  process.stdout.write('\nPowtórz hasło: ');
  const confirmation = await prompt.question(''); prompt.close(); process.stdout.write('\n');
  if (password !== confirmation) throw new Error('Hasła nie są identyczne.');
} else {
  for await (const chunk of process.stdin) { password += chunk.toString(); if (password.length > 2048) throw new Error('Za długie hasło.'); }
  password = password.replace(/\r?\n$/, '');
}
if (password.length < 8 || password.length > 1024) throw new Error('Hasło musi mieć od 8 do 1024 znaków.');
await files.write(path, JSON.stringify([{ login, password: await hashPassword(password), role: 'owner', version: 1 }], null, 2), true);
console.log(`Utworzono konto ${login}. Hasło zapisano wyłącznie jako skrót scrypt.`);
