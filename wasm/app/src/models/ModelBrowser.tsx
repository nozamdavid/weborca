import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../i18n';
import { directThumbnail, fetchModels, fetchStats, fetchModel, type CatalogQuery, type CatalogStats, type Model } from './sources';
import './models.css';
import { makerWorldDownload, makerWorldFile } from '../printers/bambuCloud';
import { requestOpenProject } from '../shell/projectActions';
import { accountPrinter, useBambuAccount } from '../printers/bambuAccount';
import { usePrinterConnectionStore } from '../printers/connectionStore';

const platformName = (source: string) => source === 'makerworld' ? 'MakerWorld' : source;

function Thumbnail({ url }: { url?: string }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const [relay, setRelay] = useState(false);
  const direct = directThumbnail(url);
  useEffect(() => { setFailed(false); setRelay(false); }, [url]);
  return url && !failed
    ? <img src={!relay && direct ? direct : url} referrerPolicy="no-referrer" loading="lazy" alt="" onLoad={event => { const img = event.currentTarget; if (img.naturalWidth > 300 || img.naturalHeight > 300) { if (!relay && direct) setRelay(true); else setFailed(true); } }} onError={() => { if (!relay && direct) setRelay(true); else setFailed(true); }} />
    : <span className="model-thumbnail-placeholder">{t('No preview available')}</span>;
}

export function ModelBrowser({ active, onPrepare }: { active: boolean; onPrepare: () => void }) {
  const { t } = useTranslation();
  const [criteria, setCriteria] = useState<CatalogQuery>({ page: 1, pageSize: 24, sort: 'newest' });
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active || !grid.current) return;
    const element = grid.current;
    const measure = () => {
      if (!element.getBoundingClientRect().width) return;
      // auto-fill exposes every track, even for empty or final partial pages.
      const columns = getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length;
      const pageSize = Math.min(Math.floor(100 / columns), Math.max(1, Math.round(24 / columns))) * columns;
      if (!pageSize) return;
      setCriteria(current => current.pageSize === pageSize ? current : { ...current, page: 1, pageSize });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [active]);
  const [models, setModels] = useState<Model[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(0);
  const [stats, setStats] = useState<CatalogStats>();
  const [statsError, setStatsError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const request = useRef<AbortController>();
  const detailsRequest = useRef<AbortController>();
  const [details, setDetails] = useState<{ id: string; text: string }>();
  const [infoModel, setInfoModel] = useState<Model>();
  const modal = useRef<HTMLDivElement>(null);
  const change = (patch: Partial<CatalogQuery>) => { setCriteria(current => ({ ...current, ...patch, page: 1 })); setDetails(undefined); detailsRequest.current?.abort(); };
  const [downloadStatus, setDownloadStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState<{ id: string; phase: 'preparing' | 'downloading'; percent?: number }>();
  const transfer = useRef<AbortController>();
  const download = async (model: Model, open = false) => {
    if (transfer.current) return;
    const id = new URL(model.url).pathname.match(/\/models\/([1-9]\d*)/)?.[1];
    const printer = useBambuAccount.getState().account ? { ...accountPrinter, printhost_apikey: useBambuAccount.getState().account!.accessToken } : usePrinterConnectionStore.getState().printers.find(p => p.host_type === 'bambu-cloud' && p.printhost_apikey &&
      ['us.mqtt.bambulab.com', 'mqtt.bambu-lab.com'].includes(p.print_host));
    if (!id || !printer) { setDownloadStatus('Sign in to Bambu Cloud under Help or the mobile menu.'); return; }
    setDownloadStatus(open ? '' : 'Preparing download…');
    if (open) setOpening({ id: model.id, phase: 'preparing' });
    setBusy(true);
    const controller = new AbortController();
    transfer.current = controller;
    try {
      if (open) {
        const file = await makerWorldFile(printer, id, controller.signal, percent => {
          if (!controller.signal.aborted) setOpening({ id: model.id, phase: 'downloading', percent });
        });
        setOpening(undefined);
        setInfoModel(undefined);
        if (await requestOpenProject(file)) onPrepare();
        return;
      }
      const url = await makerWorldDownload(printer, id, controller.signal);
      const link = document.createElement('a');
      link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer';
      link.click();
      setDownloadStatus('Download opened in your browser. Import the downloaded 3MF in Prepare.');
    } catch {
      if (!controller.signal.aborted) setDownloadStatus('Could not open model. Check your Bambu Cloud sign-in and retry, or download on the original page.');
    } finally {
      transfer.current = undefined;
      setOpening(undefined);
      setBusy(false);
    }
  };
  const openingLabel = opening?.phase === 'downloading' ? t('Downloading...') : t('Preparing download…');
  const openButton = (model: Model, classes: string) => {
    const working = opening?.id === model.id;
    return <button className={classes} disabled={busy} aria-busy={working} onClick={() => void download(model, true)}>
      {working && opening.percent === undefined && <span className="ds-spinner" aria-hidden="true" />}
      {working ? openingLabel : t('Open in slicer')}{working && opening.percent !== undefined && ` ${opening.percent}%`}
    </button>;
  };
  useEffect(() => () => { request.current?.abort(); transfer.current?.abort(); detailsRequest.current?.abort(); }, []);
  const statsKey = useRef(-1);
  const loadedKey = useRef('');
  useEffect(() => {
    if (!active || statsKey.current === retry) return;
    const controller = new AbortController();
    setStatsError(false);
    void fetchStats(controller.signal).then(result => { if (!controller.signal.aborted) { statsKey.current = retry; setStats(result); } }).catch(() => { if (!controller.signal.aborted) setStatsError(true); });
    return () => controller.abort();
  }, [active, retry]);
  useEffect(() => {
    if (!active) return;
    const key = JSON.stringify(criteria) + ':' + retry;
    // Keep the loaded grid across tab switches; refetch only for new criteria or an explicit retry.
    if (loadedKey.current === key) return;
    const controller = new AbortController();
    request.current = controller;
    setModels([]); setStatus('loading'); setDetails(undefined); detailsRequest.current?.abort();
    const timer = setTimeout(() => {
      void fetchModels(criteria, controller.signal).then(result => {
        if (!controller.signal.aborted) { loadedKey.current = key; setModels(result.items); setTotal(result.total); setPages(result.pages); setStatus('ready'); }
      }).catch(() => { if (!controller.signal.aborted) setStatus('error'); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [active, criteria, retry]);
  const fetchDescription = async (model: Model) => {
    detailsRequest.current?.abort();
    const controller = new AbortController(); detailsRequest.current = controller;
    setDetails({ id: model.id, text: t('Loading description…') });
    try {
      const result = await fetchModel(model.id, controller.signal);
      if (!controller.signal.aborted) setDetails({ id: model.id, text: result.description || t('No description available.') });
    } catch { if (!controller.signal.aborted) setDetails({ id: model.id, text: t('Could not load description. Try again.') }); }
  };
  const closeInfo = () => setInfoModel(undefined);
  const openInfo = (model: Model) => {
    setInfoModel(model);
    if (details?.id !== model.id) void fetchDescription(model);
  };
  useEffect(() => {
    if (!infoModel) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopImmediatePropagation(); event.preventDefault(); closeInfo(); } };
    window.addEventListener('keydown', onKey, true);
    const timer = window.setTimeout(() => modal.current?.querySelector<HTMLElement>('.model-modal-close')?.focus(), 0);
    return () => { window.removeEventListener('keydown', onKey, true); clearTimeout(timer); previous?.focus(); };
  }, [infoModel]);
  return <section className="model-browser" aria-labelledby="models-title" aria-busy={status === 'loading'}>
    <h1 id="models-title" className="ds-title--page">{t('Models')}</h1>
    <p>{t('Discover models and open their original pages. Download files there, then import them in Prepare.')}</p>
    <form className="model-search" onSubmit={event => event.preventDefault()}>
      <label>{t('Search models')}<input className="ds-input" type="search" value={criteria.q || ''} onChange={event => change({ q: event.target.value })} /></label>
      <label>{t('Sort')}<select className="ds-select" value={criteria.sort} onChange={event => change({ sort: event.target.value as CatalogQuery['sort'] })}>
        {['newest', 'oldest', 'relevance', 'likes', 'downloads'].map(value => <option key={value} value={value}>{t(value)}</option>)}
      </select></label>
      <label>{t('Category')}<select className="ds-select" value={criteria.category || ''} onChange={event => change({ category: event.target.value })}>
        <option value="">{t('All categories')}</option>{stats?.categories.map(choice => <option key={choice.name}>{choice.name}</option>)}
      </select></label>
      <button className="ds-btn" type="button" onClick={() => setCriteria(current => ({ page: 1, pageSize: current.pageSize, sort: 'newest' }))}>{t('Clear filters')}</button>
    </form>
    <details className="model-advanced"><summary>{t('Advanced filters')}</summary><div className="model-filter-fields">
      {(['author', 'license', 'subcategory'] as const).map(key => <label key={key}>{t(key === 'author' ? 'Author (exact)' : key === 'license' ? 'License (exact)' : 'Subcategory (exact)')}<input className="ds-input" value={criteria[key] || ''} list={key === 'subcategory' ? undefined : `model-${key}`} onChange={event => change({ [key]: event.target.value })} />{key !== 'subcategory' && <datalist id={`model-${key}`}>{stats?.[key === 'author' ? 'authors' : 'licenses'].map(choice => <option key={choice.name} value={choice.name} />)}</datalist>}</label>)}
      {([['minLikes', 'Minimum likes'], ['maxLikes', 'Maximum likes'], ['minDownloads', 'Minimum downloads'], ['maxDownloads', 'Maximum downloads']] as const).map(([key, label]) => <label key={key}>{t(label)}<input className="ds-input" type="number" min="0" step="1" value={criteria[key] ?? ''} onChange={event => change({ [key]: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>)}
      {([['uploadedAfter', 'Uploaded after'], ['uploadedBefore', 'Uploaded before']] as const).map(([key, label]) => <label key={key}>{t(label)}<input className="ds-input" type="date" value={criteria[key] || ''} onChange={event => change({ [key]: event.target.value })} /></label>)}
      <label>{t('Thumbnail')}<select className="ds-select" value={criteria.hasThumbnail === undefined ? '' : String(criteria.hasThumbnail)} onChange={event => change({ hasThumbnail: event.target.value === '' ? undefined : event.target.value === 'true' })}><option value="">{t('Any')}</option><option value="true">{t('With thumbnail')}</option><option value="false">{t('Without thumbnail')}</option></select></label>
    </div><fieldset className="model-formats"><legend>{t('Verified file formats (match any)')}</legend>{stats?.formats.map(choice => <label key={choice.name}><input type="checkbox" checked={criteria.formats?.includes(choice.name) || false} onChange={event => change({ formats: event.target.checked ? [...(criteria.formats || []), choice.name] : criteria.formats?.filter(format => format !== choice.name) })} />.{choice.name}</label>)}</fieldset></details>
    {statsError && <p>{t('Filter choices unavailable. Retry to load them.')} <button className="ds-btn" onClick={() => setRetry(value => value + 1)}>{t('Retry')}</button></p>}
    <div role="status" aria-live="polite">
      {status === 'loading' && t('Loading catalog…')}
      {status === 'error' && <p>{t('Could not load the catalog. Check your connection and retry.')} <button className="ds-btn" onClick={() => setRetry(value => value + 1)}>{t('Retry')}</button></p>}
      {status === 'ready' && (total ? t('{{count}} models', { count: total }) : t('No models found. Try another search or clear the filters.'))}
    </div>
    {downloadStatus && <p role="status">{t(downloadStatus)}</p>}
    {opening && !infoModel && <span className="ds-visually-hidden" role="status">{openingLabel}</span>}
    <div className="model-grid" ref={grid}>{models.map(model => <div key={model.id} className="model-cell"><a className="model-card" href={model.url} target="_blank" rel="noopener noreferrer"
      onClick={event => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); openInfo(model); }}>
      <div className="model-thumbnail"><Thumbnail url={model.thumbnail} /></div>
      <div className="model-card-copy"><h2>{model.title}</h2><p>{model.source} · {model.fileFormats.length ? model.fileFormats.map(ext => `.${ext}`).join(', ') : t('No verified file formats')}</p>{model.estimatedFileFormats.length > 0 && <p>{t('Estimated formats: {{formats}}', { formats: model.estimatedFileFormats.map(ext => `.${ext}`).join(', ') })}</p>}{(model.author || model.license) && <p>{[model.author, model.license].filter(Boolean).join(' · ')}</p>}{model.tags.length > 0 && <div className="model-tags">{model.tags.slice(0, 2).map(tag => <span key={tag} className="model-tag">{tag}</span>)}</div>}</div>
    </a><div className="model-card-actions">
      <button className="ds-btn ds-btn--sm" onClick={() => openInfo(model)}>{t('More info')}</button>
      {new URL(model.url).hostname === 'makerworld.com' && <><button className="ds-btn ds-btn--sm" disabled={busy} onClick={() => void download(model)}>{t('Download 3MF')}</button>{openButton(model, 'ds-btn ds-btn--sm ds-btn--subtle model-card-open')}</>}
    </div></div>)}</div>
    {status === 'ready' && pages > 0 && <nav className="model-pagination" aria-label={t('Model pages')}><button className="ds-btn" disabled={(criteria.page || 1) <= 1} onClick={() => setCriteria(current => ({ ...current, page: (current.page || 1) - 1 }))}>{t('Previous')}</button><span>{t('Page {{page}} of {{pages}}', { page: criteria.page || 1, pages })}</span><button className="ds-btn" disabled={(criteria.page || 1) >= pages} onClick={() => setCriteria(current => ({ ...current, page: (current.page || 1) + 1 }))}>{t('Next')}</button></nav>}
    {infoModel && <div className="model-modal-backdrop" onClick={event => { if (event.target === event.currentTarget) closeInfo(); }}>
      <div className="model-modal" role="dialog" aria-modal="true" aria-labelledby="model-modal-title" ref={modal}>
        <button className="ds-icon-btn model-modal-close" type="button" aria-label={t('Close')} onClick={closeInfo}>✕</button>
        <div className="model-modal-thumb"><Thumbnail url={infoModel.thumbnail} /></div>
        <div className="model-modal-copy">
          <h2 id="model-modal-title">{infoModel.title}</h2>
          <p>{platformName(infoModel.source)} · {infoModel.fileFormats.length ? infoModel.fileFormats.map(ext => `.${ext}`).join(', ') : t('No verified file formats')}</p>
          {infoModel.estimatedFileFormats.length > 0 && <p>{t('Estimated formats: {{formats}}', { formats: infoModel.estimatedFileFormats.map(ext => `.${ext}`).join(', ') })}</p>}
          {(infoModel.author || infoModel.license) && <p>{[infoModel.author, infoModel.license].filter(Boolean).join(' · ')}</p>}
          {infoModel.tags.length > 0 && <div className="model-tags">{infoModel.tags.map(tag => <span key={tag} className="model-tag">{tag}</span>)}</div>}
          <p className="model-modal-description" role="status">{details?.id === infoModel.id ? details.text : t('Loading description…')}</p>
          {downloadStatus && <p className="model-modal-status" role="status">{t(downloadStatus)}</p>}
          {opening && <span className="ds-visually-hidden" role="status">{openingLabel}</span>}
          <div className="model-modal-actions">
            <a className="ds-btn ds-btn--primary" href={infoModel.url} target="_blank" rel="noopener noreferrer">{t('Open in {{platform}}', { platform: platformName(infoModel.source) })}</a>
            {new URL(infoModel.url).hostname === 'makerworld.com' && <><button className="ds-btn" disabled={busy} onClick={() => void download(infoModel)}>{t('Download 3MF')}</button>{openButton(infoModel, 'ds-btn ds-btn--subtle')}</>}
          </div>
        </div>
      </div>
    </div>}
  </section>;
}
