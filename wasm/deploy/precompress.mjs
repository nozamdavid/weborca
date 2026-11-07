/** Build-time compression for the static server: writes `<file>.br` (quality 11) and `<file>.gz` (level 9) next to each compressible file. */
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { brotliCompress, constants as zc, gzip } from 'node:zlib';
import { promisify } from 'node:util';
import path from 'node:path';

const root = path.resolve(process.argv[2] || 'dist');
const compressible = new Set(['.html', '.js', '.mjs', '.css', '.wasm', '.json', '.svg', '.txt']);
const brotli = promisify(brotliCompress);
const gz = promisify(gzip);

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && compressible.has(path.extname(entry.name).toLowerCase())) yield full;
  }
}

async function upToDate(target, sourceInfo) {
  const info = await stat(target).catch(() => undefined);
  return info && info.mtimeMs >= sourceInfo.mtimeMs;
}

async function compress(file) {
  const info = await stat(file);
  if (info.size <= 1024) return { raw: 0, br: 0, gz: 0 };
  let raw;
  const sizes = { raw: info.size, br: 0, gz: 0 };
  for (const [ext, run] of [
    ['.br', (data) => brotli(data, { params: { [zc.BROTLI_PARAM_QUALITY]: 11, [zc.BROTLI_PARAM_LGWIN]: 24, [zc.BROTLI_PARAM_SIZE_HINT]: data.length } })],
    ['.gz', (data) => gz(data, { level: 9 })]
  ]) {
    const target = file + ext;
    if (await upToDate(target, info)) { sizes[ext.slice(1)] = (await stat(target)).size; continue; }
    raw ??= await readFile(file);
    const out = await run(raw);
    // A variant that does not save anything is not worth serving.
    if (out.length >= raw.length) continue;
    await writeFile(target, out);
    sizes[ext.slice(1)] = out.length;
  }
  return sizes;
}

const files = [];
for await (const file of walk(root)) files.push(file);
// Largest first, two at a time: brotli q11 on the 30 MB engine takes about a minute and a lot of memory.
const sized = await Promise.all(files.map(async (file) => [file, (await stat(file)).size]));
sized.sort((a, b) => b[1] - a[1]);
const queue = sized.map(([file]) => file);
const totals = { raw: 0, br: 0, gz: 0 };
const workers = Array.from({ length: 2 }, async () => {
  for (let file = queue.shift(); file; file = queue.shift()) {
    const result = await compress(file);
    for (const key of Object.keys(totals)) totals[key] += result[key];
    if (result.raw > 5_000_000) console.log(`${path.relative(root, file)}: ${(result.raw / 1e6).toFixed(1)} MB -> br ${(result.br / 1e6).toFixed(2)} MB, gzip ${(result.gz / 1e6).toFixed(2)} MB`);
  }
});
await Promise.all(workers);
console.log(`precompressed ${files.length} files: ${(totals.raw / 1e6).toFixed(1)} MB -> br ${(totals.br / 1e6).toFixed(1)} MB, gzip ${(totals.gz / 1e6).toFixed(1)} MB`);
