import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(dir)
  .filter((f) => f.endsWith('.test.mjs'))
  .sort();

for (const file of files) {
  await import(path.join(dir, file));
}
