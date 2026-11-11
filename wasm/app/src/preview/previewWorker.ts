/// <reference lib="webworker" />
export {};
const scope = self as unknown as DedicatedWorkerGlobalScope;
let modulePromise: Promise<any> | null = null;
async function runtime(): Promise<any> {
  if (!modulePromise) modulePromise = (async () => {
    let imported: any;
    try {
      const runtimeUrl = '/preview/orca_preview.js';
      imported = await import(/* @vite-ignore */ runtimeUrl);
    } catch {
      const runtimeUrl = '/orca_preview.js';
      imported = await import(/* @vite-ignore */ runtimeUrl);
    }
    const mod = await (imported.default || imported)({ locateFile: (path: string) => path.endsWith('.wasm') ? '/preview/orca_preview.wasm' : path });
    try {
      const response = await fetch('/profiles/resources.json');
      if (!response.ok) throw new Error('Preview runtime resources are unavailable');
      const bundle = await response.json() as { files: Record<string, string> };
      mod.FS.mkdirTree('/resources/info');
      for (const [path, contents] of Object.entries(bundle.files))
        if (path.startsWith('info/') && !path.includes('..')) mod.FS.writeFile(`/resources/${path}`, contents);
    } catch (error) { console.warn('[OrcaPreview] Could not load runtime resources:', error); }
    return mod;
  })().catch(error => { modulePromise = null; throw error; });
  return modulePromise;
}
scope.onmessage = async ({ data }: MessageEvent<{ id: number; bytes: ArrayBuffer }>) => {
  const input = `/preview_input_${data.id}`;
  const packet = `/preview_packet_${data.id}`;
  let mod: any;
  try {
    mod = await runtime();
    mod.FS.writeFile(input, new Uint8Array(data.bytes));
    const stats = JSON.parse(mod.parseGcode(input, packet));
    if (stats.error) throw new Error(stats.error);
    const bytes = new Uint8Array(mod.FS.readFile(packet)).slice();
    scope.postMessage({ id: data.id, stats, packet: bytes.buffer }, [bytes.buffer]);
  } catch (error) {
    scope.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) });
  } finally {
    if (mod) for (const path of [input, packet]) try { mod.FS.unlink(path); } catch { /* absent */ }
  }
};
