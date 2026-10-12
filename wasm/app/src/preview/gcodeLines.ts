/** Index source bytes without decoding or allocating a display object for every line. */
export interface GcodeLineIndex {
  bytes: Uint8Array;
  offsets: Uint32Array;
}

export interface ParsedLine {
  lineNumber: number;
  command: string;
  parameters: string;
  comment: string;
}

const indexes = new WeakMap<Uint8Array, GcodeLineIndex>();
const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });

export function indexGcodeLines(bytes: Uint8Array): GcodeLineIndex {
  const cached = indexes.get(bytes);
  if (cached) return cached;
  let count = 1;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 10) count++;
  const offsets = new Uint32Array(count + 1);
  let line = 1;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 10) offsets[line++] = i + 1;
  offsets[count] = bytes.length;
  const index = { bytes, offsets };
  indexes.set(bytes, index);
  return index;
}

export function readGcodeLines(index: GcodeLineIndex, lineNumber: number): ParsedLine[] {
  const { bytes, offsets } = index;
  const count = bytes.length ? offsets.length - 1 : 0;
  const center = Math.max(0, lineNumber - 1);
  const lines: ParsedLine[] = [];
  for (let i = Math.max(0, center - 40); i < Math.min(count, center + 41); i++) {
    let end = offsets[i + 1];
    if (bytes[end - 1] === 10) end--;
    if (bytes[end - 1] === 13) end--;
    // Keep the desktop's character truncation after decoding, including UTF-8 comments.
    let display = decoder.decode(bytes.subarray(offsets[i], end));
    if (i === 0 && display.charCodeAt(0) === 0xfeff) display = display.slice(1);
    if (display.length > 55) display = display.slice(0, 52) + '...';
    const semicolon = display.indexOf(';');
    const comment = semicolon === -1 ? '' : display.slice(semicolon);
    const commandText = (semicolon === -1 ? display : display.slice(0, semicolon)).trim();
    const space = commandText.indexOf(' ');
    lines.push({
      lineNumber: i + 1,
      command: space === -1 ? commandText : commandText.slice(0, space),
      parameters: space === -1 ? '' : commandText.slice(space + 1).trim(),
      comment
    });
  }
  return lines;
}
