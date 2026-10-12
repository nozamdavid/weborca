import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from '../../app/node_modules/typescript/lib/typescript.js';

const source = fs.readFileSync(new URL('../../app/src/preview/gcodeLines.ts', import.meta.url), 'utf8');
const js = ts.transpile(source, { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 });
const { indexGcodeLines, readGcodeLines } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const encode = (text) => new TextEncoder().encode(text);

test('source line numbering includes blank lines, CRLF and a trailing newline', () => {
  const bytes = encode('G1 X2 ;café\r\n\r\n; 日本語\nG2 X4\n');
  const original = bytes.slice();
  const index = indexGcodeLines(bytes);
  assert.deepEqual(readGcodeLines(index, 4), [
    { lineNumber: 1, command: 'G1', parameters: 'X2', comment: ';café' },
    { lineNumber: 2, command: '', parameters: '', comment: '' },
    { lineNumber: 3, command: '', parameters: '', comment: '; 日本語' },
    { lineNumber: 4, command: 'G2', parameters: 'X4', comment: '' },
    { lineNumber: 5, command: '', parameters: '', comment: '' }
  ]);
  assert.deepEqual(bytes, original);
  assert.equal(indexGcodeLines(bytes), index);
});

test('large files only decode the 81 source lines around the current move', () => {
  const bytes = encode(Array.from({ length: 100_000 }, (_, i) => `G1 X${i}`).join('\n'));
  const index = indexGcodeLines(bytes);
  const lines = readGcodeLines(index, 50_000);
  assert.equal(lines.length, 81);
  assert.equal(lines[0].lineNumber, 49_960);
  assert.deepEqual(lines[40], { lineNumber: 50_000, command: 'G1', parameters: 'X49999', comment: '' });
  assert.equal(lines[80].lineNumber, 50_040);
  assert.equal(readGcodeLines(index, 0)[0].lineNumber, 1);
  assert.equal(readGcodeLines(index, 100_000).at(-1).lineNumber, 100_000);
});

test('display truncation counts decoded characters and leaves original G-code intact', () => {
  const bytes = encode(`;${'é'.repeat(60)}`);
  assert.equal(readGcodeLines(indexGcodeLines(bytes), 1)[0].comment, `;${'é'.repeat(51)}...`);
  assert.equal(new TextDecoder().decode(bytes), `;${'é'.repeat(60)}`);
  assert.deepEqual(readGcodeLines(indexGcodeLines(new Uint8Array()), 1), []);
});


test('UTF-8 BOM is stripped at the file start only', () => {
  const lines = readGcodeLines(indexGcodeLines(encode('\ufeffG1 X1\n;\ufeffcomment\n\ufeff;comment')), 1);
  assert.equal(lines[0].command, 'G1');
  assert.equal(lines[1].comment, ';\ufeffcomment');
  assert.equal(lines[2].comment, ';comment');
});
