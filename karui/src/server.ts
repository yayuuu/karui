import { buildApp } from './app.js';
import { configFromEnv } from './config.js';

const config = configFromEnv();
const app = await buildApp(config, true);
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => { if (closing) return; closing = true; await app.close(); process.exit(0); });
}
await app.listen({ host: config.host, port: config.port });
