---
title: Files, dependencies, compilation, and worker pool
format: markdown
---
## Dependencies

A plugin may have its own `package.json`, `package-lock.json`, and `node_modules`. The compiler bundles locally imported backend files into one output file. Node packages remain external and are resolved relative to the plugin entry point.

The backend targets CommonJS (CJS) on Node 24. Check package compatibility, especially with ESM-only packages or top-level `await`. Client code and its dependencies are bundled as browser ESM targeting ES2022. Libraries that require the DOM do not work in a Web Worker.

Install one plugin’s dependencies with `npm ci --omit=dev --ignore-scripts` in its directory, or install all plugins locally or through Docker:

```sh
npm run plugins:install
docker compose --profile tools run --rm plugins-install
```

The tool uses `npm ci` when a lockfile exists and `npm install` otherwise. It skips `devDependencies`, install scripts, `audit`, and `fund`, so runtime packages belong in `dependencies`. Native packages must match the target system and architecture; copied `node_modules` from another system may not work.

## Versioning

The engine prepares its worker pool at startup but does not compile plugins. The first request checks the manifest and searches for an artifact. A missing or invalid artifact, or a changed `version`, triggers compilation.

Increase the version after changing backend code, helpers, views, client code, CSS, `assets/`, dependencies, or `admin`/`concurrent`. A source timestamp alone does not rebuild. Artifacts contain backend and client code, styles, and Edge templates, but not runtime state such as JSON read by the handler.

The cache key includes the artifact format, esbuild version, Node major version, absolute plugin path, and manifest version. Artifacts and public resource snapshots are written atomically under `CONTENT_CACHE_DIR/plugins`. The engine keeps up to 32 in memory. Cached files are disposable and may disappear with tmpfs.

JS and CSS URLs contain `?v=...`; `assets/` URLs contain the artifact key. Public files use immutable caching and administration assets use `no-store`. Never place secrets in public code or assets. An unreadable manifest blocks the plugin even if an artifact is cached.

## Workers

### What a worker runs

These are backend `node:worker_threads`, not [browser Web Workers](/plugins/client). They are separate threads in one Node process, not containers. Each has its own JavaScript engine and globals; different threads can execute JavaScript in parallel. See [Node worker threads](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html#worker-threads).

The main thread accepts HTTP requests and passes plugin data to the pool. A worker calls the handler and renders Edge when the response is a view. HTML or JSON returns to the engine for delivery.

One worker handles one task at a time. Waiting for `await readFile(...)` or `await fetch(...)` still occupies the slot; another task starts only after completion.

### Permanent pool and extra threads

The engine keeps eight permanent workers by default, shared by all plugins. If none is free and concurrency permits another task, it can create temporary workers up to 16 total. Beyond that, work waits in the queue.

Temporary workers may remain idle for ten seconds after completing a task. Another task resets that lifetime. Idle expiry never interrupts running work; execution timeout is separate.

The pool prefers an idle worker already loaded with the correct plugin version, then an unassigned one. Each worker is tied to one version of one plugin. Reusing its slot for another plugin or version replaces the thread. “Permanent” describes the pool slot, not an immortal instance or durable globals.

Edge loads when preparing the worker; plugin code and dependencies load with its first task. The first visit can therefore be slower. Pool startup does not compile plugins.

With an 8/16 pool, twelve permitted concurrent tasks may use twelve workers. If all target one `concurrent: false` plugin, only one runs despite free workers.

### Pool settings

| Variable | Default | Range |
| --- | --- | --- |
| `PLUGIN_WORKERS` | 8 | 1–64 |
| `PLUGIN_MAX_WORKERS` | max(16, permanent) | 1–128, not below permanent |
| `PLUGIN_WORKER_IDLE_MS` | 10000 | 100–300000 ms |
| `PLUGIN_TIMEOUT_MS` | 5000 | 100–30000 ms |
| `PLUGIN_WORKER_OLD_GENERATION_MB` | 64 | 16–4096 MB, integer |
| `PLUGIN_WORKER_YOUNG_GENERATION_MB` | 16 | 4–1024 MB, integer |
| `PLUGIN_WORKER_STACK_MB` | 4 | 1–64 MB, integer |
| `CONTENT_CACHE_DIR` | temp + `karui-cache` | Docker: `/var/cache/karui` on tmpfs |
| `CONTENT_REFRESH_MS` | 1000 | 100–60000 ms |
| `HTTP_COMPRESSION` | true | `true` or `false` |

`HTTP_COMPRESSION=true` enables compression for responses that benefit from it. The engine selects Brotli or gzip from the browser's `Accept-Encoding` header; Brotli takes priority when the client accepts both formats. Images and videos stored in compressed formats are not compressed again. Set it to `false` to disable this feature completely, for example when compression is handled exclusively by a reverse proxy.

The documentation uses one permanent worker and at most four. Main Compose sets `PLUGIN_WORKERS` and `PLUGIN_MAX_WORKERS` separately. More workers increase throughput, RAM use, and CPU load; they do not speed up one handler or a `concurrent: false` queue. Tune with measurements from real workloads.

### Understanding V8 memory limits

V8 is Node’s JavaScript engine. It stores objects on a heap and reclaims unreachable ones with the garbage collector (GC). Returning from a function does not immediately release all memory.

Most new objects begin in the young generation. Objects that survive collections can move to the old generation. These names describe object lifetime, not code age. See [V8 generations and GC](https://v8.dev/blog/trash-talk#generational-layout).

`karui/src/plugins/pool.ts` maps environment settings to `resourceLimits`:

| Setting | Default | Meaning |
| --- | ---: | --- |
| `maxYoungGenerationSizeMb` | 16 MB | Recently created objects. Filling it triggers GC; it is not a request/file limit. |
| `maxOldGenerationSizeMb` | 64 MB | Main heap and longer-lived values such as globals, libraries, and templates. |
| `stackSizeMb` | 4 MB | Function call stack. Deep recursion can overflow it with small input. |

Values apply to every permanent, temporary, and replacement worker. They are neither reserved memory nor a guarantee that total worker use is their sum.

Set them in `.env`:

```dotenv
PLUGIN_WORKER_OLD_GENERATION_MB=128
PLUGIN_WORKER_YOUNG_GENERATION_MB=32
PLUGIN_WORKER_STACK_MB=4
```

Compose passes them at container start; they are not image build arguments. Recreate the service:

```sh
docker compose up -d --force-recreate karui
docker compose -f docker-compose.docs.yml up -d --force-recreate docs
```

`docker compose restart` does not reload environment values. No image rebuild or plugin version bump is needed. Without Docker, pass variables to Node; the engine does not load `.env` itself. Invalid values fail startup.

Avoid simultaneously setting `--max-old-space-size` or `--max-semi-space-size`, including through `NODE_OPTIONS`, because they may override worker heap limits. See [`resourceLimits`](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html#new-workerfilename-options).

If a plugin appends every report to a global array, GC cannot reclaim them while referenced. Memory grows although each request is small. Use a bounded cache or storage instead of only raising limits. A deeply recursive tree traversal can instead overflow the stack; limit depth or use an explicit iterative queue.

### What the limits do not cover

`resourceLimits` cover V8, not all process memory. Some `ArrayBuffer` data and native-library memory remain outside the heap. A V8 limit may terminate one worker, while process-wide exhaustion can terminate the application.

A decoded 5000 × 5000 RGBA image uses about 100 MB before copies and library workspace, even if its PNG is small. Limit input dimensions, operation concurrency, and retained results. The container limit is a final boundary, not a graceful per-task rejection mechanism.

For diagnostics:

```ts
const usage = process.memoryUsage();
const mib = (bytes: number) => Math.round(bytes / 1024 / 1024);
console.log({
  heapUsedMiB: mib(usage.heapUsed),
  externalMiB: mib(usage.external),
  arrayBuffersMiB: mib(usage.arrayBuffers),
  processRssMiB: mib(usage.rss),
});
```

`heapUsed` is the current thread’s heap. `external` includes reported external memory; `arrayBuffers` is included in it, so do not add them. `rss` covers the whole process and all workers, not only the measuring thread or the entire container. See [`process.memoryUsage()`](https://nodejs.org/docs/latest-v24.x/api/process.html#processmemoryusage).

### Failure and timeout

`PLUGIN_TIMEOUT_MS` runs from assigning a task to a ready worker until its result. It includes file/network waits, handler execution, Edge rendering, and first-task code loading. Compilation and queue wait are separate stages.

After an exception, thread exit, or timeout, the engine removes the worker and replaces permanent slots. Public plugin pages get 503 with an error view; JSON endpoints and administration get JSON with 503. The queue lock is released only when the broken thread ends.

A timeout does not undo file writes or external requests. A handler may save data and then time out while rendering, so a 503 does not prove the mutation failed. Design retries accordingly.

### Crash isolation is not permission isolation

Workers are not a sandbox for Internet code. A plugin has the process user’s filesystem permissions. `storageDir` is a suggested location, not an access boundary. Buggy code can overwrite another plugin’s files; malicious code can read or transmit accessible data. A separate thread and `concurrent: false` do not prevent this.

Ordinary JavaScript exceptions can be contained by terminating a worker. Native crashes or process-wide exhaustion may affect the whole application. Use trusted code and dependencies, validate input, and keep backups.

Do not retain request-sensitive data in globals. A worker that served administration may later render a public view. Always use the current `context`; never cache sessions, CSRF tokens, or user data globally.

## Concurrency and state

### What `concurrent` changes

Concurrency means several tasks are in progress, potentially in parallel:

```json
{ "version": "1", "concurrent": false, "admin": true }
```

| Setting | Same-plugin requests | Use when |
| --- | --- | --- |
| `false` (default) | One task at a time; others wait. Different plugins may run. | The plugin reads, changes, and writes shared file state. |
| `true` | Tasks may use separate workers when capacity exists. | Tasks are independent/read-only or shared writes have their own synchronization. |

The queue covers the entire plugin directory: all assigned pages, resources, URL parameters, methods, and administration. There is no separate policy for `GET` or `POST`. Increase `version` after changing it.

With `concurrent: false`, a long request A delays a short request B to the same plugin even for unrelated resources. More workers do not change this rule.

### Example: two clicks increment only once

Suppose `settings.json` contains `count: 10`:

```ts
const settings = await readSettings(context.storageDir);
settings.count += 1;
await saveSettings(context.storageDir, settings);
return { type: 'json', data: { count: settings.count } };
```

| Step | Request A | Request B | File |
| --- | --- | --- | ---: |
| 1 | Reads 10 | — | 10 |
| 2 | — | Reads 10 | 10 |
| 3 | Writes 11 | — | 11 |
| 4 | — | Writes 11 | 11 |

Both succeed with valid JSON, but one update is lost. With `concurrent: false`, B starts after A and writes 12, provided nothing outside the queue edits the file.

### Atomic replacement and queues solve different problems

Writing a temporary file and replacing the target with `rename` prevents half-written JSON, but does not make “read → change → write” atomic. For simple shared state, combine `concurrent: false` with an atomic replacement using a unique temporary file in the target directory.

Do not treat parse failure as empty state and overwrite evidence needed for recovery. Replacing one file is not a transaction across several files or protection against power loss. Multi-file updates need a recovery protocol; `finally` cannot guarantee cleanup after forced worker termination.

### Where queue protection ends

`concurrent: false` protects only tasks in that plugin queue. It does not cover another plugin or host tool writing the same file, manual edits, or background work continuing after the handler returns. Split independent data or use one shared writer when broader coordination is required.

### `await` must cover completion

```ts
// Wrong: the write can continue after the response.
void saveSettings(context.storageDir, settings);
return { type: 'json', data: { saved: true } };
```

```ts
// Correct: the queue waits and write errors reach the handler.
await saveSettings(context.storageDir, settings);
return { type: 'json', data: { saved: true } };
```

`Promise.all(...)` inside one handler can still race internally. Timers and background tasks are not durable queues; workers may be replaced or stopped.

### Ordering, retries, and stale forms

The queue orders requests as they arrive, not user intent. Sequence-sensitive operations need operation numbers or client-side waiting. A missing response also does not prove a write failed: retrying a successful but unacknowledged increment can apply it twice.

For safe retries, create an operation ID before the first attempt and reuse it. Store completed IDs with results, protecting the ID check and mutation together. The engine does not add idempotency automatically.

Two open forms may both contain stale state. Submit a revision number and compare it with current state under the queue or lock; return a conflict such as 409 instead of overwriting a newer change.

### Choosing the setting

Start with `concurrent: false` for shared file writes. Use `true` only when requests are independent, read immutable data, or synchronize shared writes explicitly. Remember that an apparent read may initialize a cache, create a file, or recover an interrupted operation.

Before deployment, send simultaneous requests and inspect final state, not only HTTP statuses. Test duplicate operation IDs, stale revisions, and failures between write stages using temporary data.

## Where to store data

Store state in `context.storageDir`, creating it with `mkdir({ recursive: true })`. All pages using a plugin share that directory. Derive safe deterministic keys such as a hash of `page.href` when separating page state; never use an unvalidated URL value as a path.

Use `context.cacheDir` for reconstructable data such as a fetched API response, resized preview, or parsed index. It is separate for every plugin and is located below `CONTENT_CACHE_DIR`; deployments commonly mount that directory on tmpfs. Create it with `mkdir({ recursive: true })` before the first write. Its contents may disappear after a container or host restart, so do not store settings, user data, jobs, uploads, or any other durable state there.

The state directory is not available over HTTP. Do not put durable state in worker globals or tmpfs cache. Put public downloads in `content/media`. The engine serves PNG/JPEG/WebP/GIF, MOV/MP4/WebM, MP3/OGG, WOFF2, and sandboxed HTML, but not JSON, TS, or Edge automatically.

Plugins may read their own files with Node APIs. `PluginContext` has no methods to edit pages, galleries, accounts, or the engine cache. An external tool that atomically writes a valid page file will be noticed on the next cache refresh.

## Size and queue limits

- Manifest: 4,096 characters.
- Public/admin client source: 256,000 bytes each before bundling.
- Serialized artifact: 8,000,000 bytes.
- Rendered HTML: 2,000,000 bytes.
- Non-view result: 4,000,000 bytes after JSON serialization.
- Queue: 128 tasks total, at most 48 waiting for one plugin; waiting plus running is also capped at 128.
- Queue wait: 10 seconds plus plugin timeout. Worker startup: 10 seconds.

Return JSON-serializable values: plain objects, arrays, strings, numbers, booleans, and `null`. Convert `BigInt` and avoid cycles, functions, or resource handles. Worker isolation limits failures but is not a security boundary for untrusted code.
