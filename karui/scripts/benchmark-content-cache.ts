import { performance } from 'node:perf_hooks';
import { configFromEnv } from '../src/config.js';
import { ContentRepository } from '../src/content.js';
import { CachedContentRepository } from '../src/content/cache.js';

// Read-only against content. Only this run's derived cache directory is created/removed.
const config = configFromEnv();
const source = new ContentRepository(config.contentDir);
const cached = new CachedContentRepository(config.contentDir, config.contentCacheDir);
async function measure(repository: ContentRepository) {
  const times: number[] = [];
  for (let index = 0; index < 50; index++) {
    const started = performance.now();
    await repository.load();
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  return { samples: times.length, medianMs: +times[25]!.toFixed(4), p95Ms: +times[47]!.toFixed(4) };
}
try {
  const content = await cached.load();
  await source.load();
  console.log(JSON.stringify({
    note: 'Content lookup only, not browser TTFB or total HTTP response time.',
    pages: content.pages.size,
    contentDirectory: config.contentDir,
    uncached: await measure(source),
    cached: await measure(cached),
  }, null, 2));
} finally { await cached.close(); }
