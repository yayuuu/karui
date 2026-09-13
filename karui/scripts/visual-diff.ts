import { readFile, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const report = [];
for (const slug of ['guild-wars-2', 'galeria', 'sandbox', 'linux', 'anime', 'showroom']) {
  const old = PNG.sync.read(await readFile(`artifacts/visual/${slug}-old.png`));
  const next = PNG.sync.read(await readFile(`artifacts/visual/${slug}-new.png`));
  const diff = new PNG({ width: old.width, height: old.height });
  const changed = pixelmatch(old.data, next.data, diff.data, old.width, old.height, { threshold: .15 });
  await writeFile(`artifacts/visual/${slug}-diff.png`, PNG.sync.write(diff));
  report.push({ page: slug, changedPixels: changed, percent: +(100 * changed / (old.width * old.height)).toFixed(3) });
}
await writeFile('artifacts/visual/differences.json', JSON.stringify(report, null, 2));
console.log(report);
