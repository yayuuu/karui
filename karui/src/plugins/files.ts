import { lstat, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { FastifyReply } from 'fastify';

/** Stream only a named, regular file from content/media/files. */
export async function sendPluginFile(reply: FastifyReply, contentRoot: string, name: string) {
  if (!['GET', 'HEAD'].includes(reply.request.method)) return reply.code(405).header('Allow', 'GET, HEAD').send();
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,199}$/.test(name)) return reply.code(404).send();
  let root: string;
  try {
    root = await realpath(join(contentRoot, 'media/files'));
    const file = join(root, name);
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || dirname(await realpath(file)) !== root) return reply.code(404).send();
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) return reply.code(404).send();
    throw error;
  }
  return reply.type('application/octet-stream')
    .header('Content-Disposition', `attachment; filename="${name}"`)
    .sendFile(name, root, { dotfiles: 'deny', acceptRanges: true, cacheControl: false });
}
