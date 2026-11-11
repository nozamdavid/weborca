/** Engine-only persistent reuse. Authorization and pair identity are checked on
 * every startup before consulting storage. Never cache documents or API data. */
export async function prepareEngineAssets(moduleUrl, onProgress, { fetch: request = globalThis.fetch.bind(globalThis), storage = globalThis.caches } = {}) {
  onProgress({ phase: 'checking' });
  const metadata = await request(moduleUrl, { method: 'HEAD', cache: 'no-store', credentials: 'same-origin' });
  if (!metadata.ok) throw new Error(`Engine access failed: ${metadata.status}`);
  const version = metadata.headers.get('x-orca-engine-version');
  const versioned = /^[a-f0-9]{64}$/.test(version || '');
  const loader = new URL(moduleUrl);
  const binary = new URL('orca_engine.wasm', loader);
  if (versioned) {
    loader.searchParams.set('v', version);
    binary.searchParams.set('v', version);
  }
  // Missing metadata (e.g. Vite development) or unavailable storage still permits
  // startup, but must not reuse an unverified persistent binary.
  let cache;
  if (versioned) {
    try { cache = await storage?.open('orca-engine-assets-v1'); } catch { /* Storage may be disabled/full. */ }
  }
  let saved;
  return {
    moduleUrl: loader.href,
    wasmUrl: binary.href,
    async fetch(input, options) {
      const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
      if (url !== binary.href) return request(input, options);
      let response;
      try { response = await cache?.match(binary.href); } catch { /* Fall back to network. */ }
      const cached = !!response;
      if (!response) {
        // CacheStorage owns reuse so a network-body phase always means transfer.
        response = await request(input, { ...options, cache: 'no-store' });
        if (!response.ok) throw new Error(`Engine download failed: ${response.status}`);
        if (versioned && response.headers.get('x-orca-engine-version') !== version) throw new Error('Engine release changed; reload to retry');
      }
      if (!response.body) throw new Error('Engine response has no body');
      const decoded = Number(response.headers.get('x-orca-decoded-length'));
      const identity = !response.headers.get('content-encoding');
      const length = Number(response.headers.get('content-length'));
      const total = Number.isSafeInteger(decoded) && decoded > 0 ? decoded
        : identity && Number.isSafeInteger(length) && length > 0 ? length : undefined;
      let loaded = 0;
      onProgress({ phase: cached ? 'cached' : 'downloading', ...(cached ? {} : { loaded, total }) });
      const headers = new Headers(response.headers);
      // The fetch body is already decoded. Cached Responses must describe those bytes.
      headers.delete('content-encoding');
      headers.delete('content-length');
      const body = response.body.pipeThrough(new TransformStream({
        transform(chunk, controller) {
          loaded += chunk.byteLength;
          // Never show a bogus percentage if a server's size claim is violated.
          if (!cached) onProgress({ phase: 'downloading', loaded, total: total && loaded <= total ? total : undefined });
          controller.enqueue(chunk);
        },
        flush() {
          if (total && loaded !== total) throw new Error('Incomplete engine download');
          onProgress({ phase: 'initializing' });
        }
      }));
      const result = new Response(body, { status: response.status, statusText: response.statusText, headers });
      if (!cached && cache) {
        saved = cache.put(binary.href, result.clone()).catch(() => {});
      }
      return result;
    },
    async finish() { await saved; }
  };
}
