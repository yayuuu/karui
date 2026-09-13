import { randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { PanelFiles, PanelError, digest, isMissing } from './files.js';
import { hashPassword, verifyPassword } from './password.js';

export const accountSchema = z.object({ login: z.string().regex(/^[A-Za-z0-9_-]{1,48}$/), password: z.string(), role: z.enum(['owner', 'admin']), version: z.number().int().positive() });
export type Account = z.infer<typeof accountSchema>;
export type Session = { csrf: string; expires: number; login?: string; version?: number };
const accountsPath = 'state/panel/accounts.json';
const token = () => randomBytes(32).toString('hex');
const lifetime = 8 * 60 * 60 * 1000;

export class PanelAuth {
  private sessions = new Map<string, Session>();
  private attempts = new Map<string, { count: number; until: number }>();
  private dummy = '';
  readonly cookieName: string;
  constructor(readonly files: PanelFiles, private secure: boolean) { this.cookieName = secure ? '__Host-karui-panel' : 'karui-panel'; }
  async init() { this.dummy = await hashPassword(token()); }
  async accounts(): Promise<Account[]> {
    try { return z.array(accountSchema).max(100).parse(JSON.parse((await this.files.read(accountsPath)).toString())); }
    catch (error) { if (isMissing(error)) return []; throw error; }
  }
  private options() { return { path: '/', httpOnly: true, secure: this.secure, sameSite: 'strict' as const, maxAge: lifetime / 1000 }; }
  session(request: FastifyRequest, reply: FastifyReply): Session {
    const now = Date.now();
    for (const [key, session] of this.sessions) if (session.expires <= now) this.sessions.delete(key);
    const cookie = request.cookies[this.cookieName];
    if (cookie) { const session = this.sessions.get(digest(cookie)); if (session) return session; }
    if (this.sessions.size >= 2000) throw new PanelError('Too many sessions. Try again later.', 503);
    const id = token(); const session: Session = { csrf: token(), expires: now + lifetime };
    this.sessions.set(digest(id), session);
    reply.setCookie(this.cookieName, id, this.options());
    return session;
  }
  async account(session: Session) {
    return (await this.accounts()).find(account => account.login === session.login && account.version === session.version);
  }
  async login(request: FastifyRequest, reply: FastifyReply, login: string, password: string) {
    const now = Date.now();
    for (const [key, value] of this.attempts) if (value.until < now) this.attempts.delete(key);
    const key = login.toLowerCase(); const attempt = this.attempts.get(key);
    if ((attempt?.count ?? 0) >= 8) throw new PanelError('Too many login attempts. Try again in 10 minutes.', 429);
    const account = (await this.accounts()).find(account => account.login === login);
    const valid = await verifyPassword(password, account?.password ?? this.dummy);
    if (!valid || !account) {
      if (this.attempts.size < 2000) this.attempts.set(key, { count: (attempt?.count ?? 0) + 1, until: attempt?.until ?? now + 600_000 });
      throw new PanelError('Invalid login or password.', 401);
    }
    this.attempts.delete(key);
    this.logout(request, reply);
    const id = token();
    this.sessions.set(digest(id), { csrf: token(), expires: now + lifetime, login: account.login, version: account.version });
    reply.setCookie(this.cookieName, id, this.options());
  }
  logout(request: FastifyRequest, reply: FastifyReply) {
    const cookie = request.cookies[this.cookieName];
    if (cookie) this.sessions.delete(digest(cookie));
    reply.clearCookie(this.cookieName, this.options());
  }
  async saveAccount(actor: Account, input: { login: string; password: string; confirmation: string }, create: boolean) {
    if (actor.role !== 'owner' && (create || input.login !== actor.login)) throw new PanelError('Permission denied.', 403);
    if (input.password !== input.confirmation) throw new PanelError('The passwords do not match.');
    if (input.password.length < 8 || input.password.length > 1024) throw new PanelError('The password must be between 8 and 1024 characters long.');
    const accounts = await this.accounts();
    const existing = accounts.find(account => account.login === input.login);
    if (create ? !!existing : !existing) throw new PanelError(create ? 'The account already exists.' : 'Account not found.');
    if (create && accounts.length >= 100) throw new PanelError('The account limit has been reached.');
    const next = accountSchema.parse({ login: input.login, password: await hashPassword(input.password), role: existing?.role ?? 'admin', version: (existing?.version ?? 0) + 1 });
    await this.files.write(accountsPath, JSON.stringify([...accounts.filter(account => account.login !== input.login), next], null, 2));
    for (const [key, session] of this.sessions) if (session.login === input.login) this.sessions.delete(key);
  }
  async deleteAccount(actor: Account, login: string) {
    if (actor.role !== 'owner') throw new PanelError('Permission denied.', 403);
    const accounts = await this.accounts(); const target = accounts.find(account => account.login === login);
    if (!target || target.role === 'owner') throw new PanelError('The primary administrator cannot be deleted.');
    await this.files.write(accountsPath, JSON.stringify(accounts.filter(account => account.login !== login), null, 2));
    for (const [key, session] of this.sessions) if (session.login === login) this.sessions.delete(key);
  }
}
