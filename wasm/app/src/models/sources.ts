export const CATALOG_ENDPOINT = import.meta.env?.VITE_MODEL_CATALOG_API_URL ||
  'https://models.noz.am';

export function directThumbnail(relay?: string): string | undefined {
  const ua = globalThis.navigator?.userAgent || '';
  const chrome = ua.match(/(?:Chrome|Chromium)\/(\d+)/);
  if (import.meta.env?.VITE_COEP !== 'credentialless' || !chrome || Number(chrome[1]) < 110 || /EdgiOS|CriOS|Firefox|; wv\)/.test(ua) || !globalThis.crossOriginIsolated || !relay?.startsWith('/_model-thumbnail/v300?url=')) return;
  try {
    if ([...new URL(relay, 'https://localhost').searchParams.keys()].join() !== 'url') return;
    const url = new URL(new URL(relay, 'https://localhost').searchParams.get('url')!);
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash) return;
    if (url.hostname === 'makerworld.bblmw.com') {
      if (!/^\/makerworld\/model\/[A-Za-z0-9_-]+\/design\/[A-Za-z0-9_-]+\.(png|jpe?g|jfif|gif|webp)$/i.test(url.pathname)) return;
      if (/\.jfif$/i.test(url.pathname)) return;
      return url.href + '?x-oss-process=image/resize,m_lfit,w_300,h_300/format,webp';
    }
    if (url.hostname === 'media.printables.com' &&
        /^\/media\/prints\/.+\.(png|jpe?g|jfif|gif|webp)$/i.test(url.pathname) &&
        !url.pathname.split('/').includes('..')) {
      return url.href;
    }
  } catch { return; }
}

export interface Model {
  id: string; title: string; source: string; url: string; thumbnail?: string;
  fileFormats: string[]; estimatedFileFormats: string[]; author: string; license?: string;
  tags: string[];
  category?: string; subcategory?: string; likes: number; downloads: number;
  uploadedAt?: string; sourceUpdatedAt?: string; description?: string; descriptionHtml?: string;
  categoryPath?: string[]; observedAt?: string; searchText: string;
}
export interface CatalogQuery {
  q?: string; source?: 'all' | 'makerworld' | 'printables'; formats?: string[]; category?: string; subcategory?: string; author?: string; license?: string;
  minLikes?: number; maxLikes?: number; minDownloads?: number; maxDownloads?: number;
  uploadedAfter?: string; uploadedBefore?: string; hasThumbnail?: boolean;
  sort?: 'relevance' | 'newest' | 'oldest' | 'likes' | 'downloads'; page?: number; pageSize?: number;
}
export interface CatalogPage { total: number; page: number; pageSize: number; pages: number; items: Model[] }

// Share in-flight requests when a prefetched page becomes the foreground page.
export function createCatalogPageLoader() {
  const cached = new Map<string, CatalogPage>();
  const pending = new Map<string, Promise<CatalogPage>>();
  const keyFor = (query: CatalogQuery) => JSON.stringify(Object.entries(query).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)));
  const load = (query: CatalogQuery): Promise<CatalogPage> => {
    const key = keyFor(query);
    const hit = cached.get(key);
    if (hit) return Promise.resolve(hit);
    const running = pending.get(key);
    if (running) return running;
    const result = fetchModels(query).then(page => {
      cached.set(key, page);
      if (cached.size > 8) cached.delete(cached.keys().next().value!);
      return page;
    }).finally(() => pending.delete(key));
    pending.set(key, result);
    return result;
  };
  return Object.assign(load, {
    hasRequest(query: CatalogQuery) {
      const key = keyFor(query);
      return cached.has(key) || pending.has(key);
    }
  });
}

export function preloadModelThumbnails(models: Model[]) {
  for (const model of models.slice(0, 10)) {
    if (!model.thumbnail) continue;
    const image = new Image();
    const relay = model.thumbnail;
    const direct = directThumbnail(relay);
    image.referrerPolicy = 'no-referrer';
    const fallback = () => {
      if (direct && image.src === direct) image.src = relay;
    };
    image.onerror = fallback;
    image.onload = () => { if (direct?.includes('x-oss-process=') && (image.naturalWidth > 300 || image.naturalHeight > 300)) fallback(); };
    image.src = direct || relay;
  }
}
export interface CatalogCount { name: string; count: number }
export interface CatalogStats {
  models: number; formats: CatalogCount[]; categories: CatalogCount[]; authors: CatalogCount[]; licenses: CatalogCount[];
}
export class CatalogError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = 'CatalogError'; }
}
type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid catalog response');
  return value as RecordValue;
}
const string = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined;
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid catalog response');
  return value;
}
function trustedUrl(value: unknown, thumbnail = false): string | undefined {
  if (typeof value !== 'string') return;
  try {
    const url = new URL(value);
    const trusted = thumbnail
      ? ['makerworld.bblmw.com', 'makerworld.bambulab.com', 'media.printables.com'].includes(url.hostname)
      : ['makerworld.com', 'www.printables.com', 'printables.com'].includes(url.hostname);
    if (url.protocol === 'https:' && trusted && !url.username && !url.password && !url.port) return url.href;
  } catch { /* Untrusted metadata is never used as a link. */ }
}
function model(value: unknown): Model {
  const item = record(value);
  const id = String(number(item.id));
  if (item.source !== undefined && item.source !== 'makerworld' && item.source !== 'printables') throw new Error('Invalid catalog model');
  const source = item.source ?? 'makerworld';
  const url = trustedUrl(item.url);
  const parsedUrl = url ? new URL(url) : undefined;
  const validUrl = parsedUrl && (source === 'printables'
    ? (parsedUrl.hostname === 'www.printables.com' || parsedUrl.hostname === 'printables.com') &&
      (parsedUrl.pathname.startsWith(`/model/${id}-`) || parsedUrl.pathname === `/model/${id}`)
    : parsedUrl.hostname === 'makerworld.com' &&
      (parsedUrl.pathname.startsWith(`/en/models/${id}-`) || parsedUrl.pathname === `/en/models/${id}`));
  if (id === '0' || !validUrl || typeof item.title !== 'string') throw new Error('Invalid catalog model');
  const fileFormats = [...new Set(strings(item.fileFormats).map(v => v.toLowerCase().replace(/^\./, '')))];
  const author = string(item.author) ?? string(item.authorUsername) ?? '';
  return {
    id, title: item.title, source, url: parsedUrl.href, thumbnail: trustedUrl(item.thumbnailUrl, true) ? `/_model-thumbnail/v300?url=${encodeURIComponent(item.thumbnailUrl as string)}` : undefined,
    fileFormats, estimatedFileFormats: item.estimated3mf === true && !fileFormats.includes('3mf') ? ['3mf'] : [],
    author, license: string(item.license), tags: [...new Set(strings(item.tags))], category: string(item.category), subcategory: string(item.subcategory),
    likes: number(item.likes), downloads: number(item.downloads), uploadedAt: string(item.uploadedAt),
    sourceUpdatedAt: string(item.sourceUpdatedAt), description: string(item.description), descriptionHtml: string(item.descriptionHTML) ?? string(item.descriptionHtml),
    categoryPath: Array.isArray(item.categoryPath) ? strings(item.categoryPath) : undefined, observedAt: string(item.observedAt),
    searchText: [item.title, author, item.category, item.subcategory, ...strings(item.tags)].filter(v => typeof v === 'string').join(' ').toLowerCase(),
  };
}
async function request(path: string, signal?: AbortSignal, params?: CatalogQuery): Promise<unknown> {
  const url = new URL(`${CATALOG_ENDPOINT.replace(/\/$/, '')}${path}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== '' && (!Array.isArray(value) || value.length)) url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  const response = await fetch(url.href, { credentials: 'omit', signal });
  if (!response.ok) {
    let message = `Catalog request failed (${response.status})`;
    if (response.status === 400 || response.status === 404) {
      try {
        const body = record(await response.json());
        if (typeof body.error === 'string') message = body.error.replace(/[<>\u0000-\u001f\u007f]/g, '').slice(0, 300);
      } catch { /* Keep the status when the error body is invalid. */ }
    }
    throw new CatalogError(response.status, message);
  }
  return response.json();
}
export async function fetchModels(params: CatalogQuery = {}, signal?: AbortSignal): Promise<CatalogPage> {
  const data = record(await request('/models', signal, params));
  if (!Array.isArray(data.items)) throw new Error('Invalid catalog response');
  return { total: number(data.total), page: number(data.page), pageSize: number(data.pageSize), pages: number(data.pages), items: data.items.map(model) };
}
export async function fetchStats(signal?: AbortSignal): Promise<CatalogStats> {
  const data = record(await request('/stats', signal));
  const counts = (key: string): CatalogCount[] => {
    if (!Array.isArray(data[key])) throw new Error('Invalid catalog stats');
    return data[key].map(value => { const entry = record(value); if (typeof entry.name !== 'string') throw new Error('Invalid catalog stats'); return { name: entry.name, count: number(entry.c) }; });
  };
  return { models: number(data.models), formats: counts('formats'), categories: counts('categories'), authors: counts('authors'), licenses: counts('licenses') };
}
export async function fetchModel(id: string | number, signal?: AbortSignal, source?: string): Promise<Model> {
  const path = source === 'printables'
    ? `/models/printables/${encodeURIComponent(String(id))}`
    : `/models/${encodeURIComponent(String(id))}`;
  return model(await request(path, signal));
}
