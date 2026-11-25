import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog';
import { useTranslation } from '../i18n';
import { directThumbnail, createCatalogPageLoader, preloadModelThumbnails, fetchStats, fetchModel, type CatalogQuery, type CatalogStats, type Model } from './sources';
import './models.css';
import { renderSafeDescriptionHtml } from './descriptionHtml';
import { makerWorldDownload, makerWorldFile } from '../printers/bambuCloud';
import { requestOpenProject } from '../shell/projectActions';
import { useHelpStore } from '../shell/HelpDialogs';
import { accountPrinter, useBambuAccount } from '../printers/bambuAccount';
import { usePrinterConnectionStore } from '../printers/connectionStore';

const platformName = (source: string) => source === 'makerworld' ? 'MakerWorld' : source === 'printables' ? 'Printables' : source;
const modelKey = (model: Pick<Model, 'source' | 'id'>) => `${model.source}:${model.id}`;

function ModelFacts({ model, compact = false }: { model: Model; compact?: boolean }) {
  const { t } = useTranslation();
  const tags = compact ? model.tags.slice(0, 2) : model.tags;
  return <div className="model-facts">
    <p className="model-file-info"><strong>{platformName(model.source)}</strong><span>
      {model.fileFormats.length ? model.fileFormats.map(ext => `.${ext}`).join(', ') : t('No verified file formats')}
    </span></p>
    {model.estimatedFileFormats.length > 0 && <p>{t('Estimated formats: {{formats}}', { formats: model.estimatedFileFormats.map(ext => `.${ext}`).join(', ') })}</p>}
    {(model.author || model.license) && <p>{[model.author, model.license].filter(Boolean).join(' · ')}</p>}
    {tags.length > 0 && <div className="model-tags">{tags.map(tag => <span className="model-tag" key={tag}>{tag}</span>)}</div>}
  </div>;
}

function Thumbnail({ url }: { url?: string }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const [relay, setRelay] = useState(false);
  const direct = directThumbnail(url);
  useEffect(() => { setFailed(false); setRelay(false); }, [url]);
  return url && !failed
    ? <img src={!relay && direct ? direct : url} referrerPolicy="no-referrer" loading="lazy" alt="" onLoad={event => { const img = event.currentTarget; if ((img.naturalWidth > 300 || img.naturalHeight > 300) && (relay || !direct || direct.includes('x-oss-process='))) { if (!relay && direct) setRelay(true); else setFailed(true); } }} onError={() => { if (!relay && direct) setRelay(true); else setFailed(true); }} />
    : <span className="model-thumbnail-placeholder">{t('No preview available')}</span>;
}

export function ModelBrowser({ active, onPrepare }: { active: boolean; onPrepare: () => void }) {
  const { t } = useTranslation();
  const [criteria, setCriteria] = useState<CatalogQuery>({ page: 1, pageSize: 24, sort: 'newest' });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterLabels = {
    q: 'Search models', source: 'Provider', category: 'Category', author: 'Author (exact)', license: 'License (exact)', subcategory: 'Subcategory (exact)',
    minLikes: 'Minimum likes', maxLikes: 'Maximum likes', minDownloads: 'Minimum downloads', maxDownloads: 'Maximum downloads',
    uploadedAfter: 'Uploaded after', uploadedBefore: 'Uploaded before', hasThumbnail: 'Thumbnail',
  } as const;
  const activeFilters = (Object.keys(filterLabels) as (keyof typeof filterLabels)[]).filter(key => criteria[key] !== undefined && criteria[key] !== '');
  const advancedCount = activeFilters.filter(key => key !== 'q' && key !== 'category' && key !== 'source').length + (criteria.formats?.length || 0);
  const hasFilters = activeFilters.length > 0 || !!criteria.formats?.length || criteria.sort !== 'newest';
  const grid = useRef<HTMLDivElement>(null);
  const browser = useRef<HTMLElement>(null);
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
  const [details, setDetails] = useState<{ id: string; text: string; html?: string }>();
  const [infoModel, setInfoModel] = useState<Model>();
  const descriptionHtml = infoModel && details?.id === modelKey(infoModel) ? details?.html : undefined;
  const renderedDescription = useMemo(() => descriptionHtml ? renderSafeDescriptionHtml(descriptionHtml, infoModel?.url) : null, [descriptionHtml, infoModel?.url]);
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
    if (!id) return;
    if (!printer) {
      setDownloadStatus('');
      setInfoModel(undefined);
      useHelpStore.getState().open('bambu');
      return;
    }
    setDownloadStatus(open ? '' : 'Preparing download…');
    if (open) setOpening({ id: modelKey(model), phase: 'preparing' });
    setBusy(true);
    const controller = new AbortController();
    transfer.current = controller;
    try {
      if (open) {
        const file = await makerWorldFile(printer, id, controller.signal, percent => {
          if (!controller.signal.aborted) setOpening({ id: modelKey(model), phase: 'downloading', percent });
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
    const working = opening?.id === modelKey(model);
    return <button className={classes} disabled={busy} aria-busy={working} onClick={() => void download(model, true)}>
      {working && opening.percent === undefined && <span className="ds-spinner" aria-hidden="true" />}
      {working ? openingLabel : t('Open in slicer')}{working && opening.percent !== undefined && ` ${opening.percent}%`}
    </button>;
  };
  useEffect(() => () => { request.current?.abort(); transfer.current?.abort(); detailsRequest.current?.abort(); }, []);
  const statsKey = useRef(-1);
  const loadedKey = useRef('');
  const pageLoader = useRef({ retry, load: createCatalogPageLoader() });
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
    if (pageLoader.current.retry !== retry) pageLoader.current = { retry, load: createCatalogPageLoader() };
    const load = pageLoader.current.load;
    setModels([]); setStatus('loading'); setDetails(undefined); detailsRequest.current?.abort();
    const showPage = () => {
      void load(criteria).then(result => {
        if (!controller.signal.aborted) {
          loadedKey.current = key; setModels(result.items); setTotal(result.total); setPages(result.pages); setStatus('ready');
          if (result.page < result.pages) {
            void load({ ...criteria, page: result.page + 1, pageSize: result.pageSize }).then(next => {
              if (!controller.signal.aborted) preloadModelThumbnails(next.items);
            }).catch(() => { /* A failed prefetch is retried when the page is opened. */ });
          }
        }
      }).catch(() => { if (!controller.signal.aborted) setStatus('error'); });
    };
    const timer = load.hasRequest(criteria) ? undefined : setTimeout(showPage, 250);
    if (timer === undefined) showPage();
    return () => { clearTimeout(timer); controller.abort(); };
  }, [active, criteria, retry]);
  const fetchDescription = async (model: Model) => {
    detailsRequest.current?.abort();
    const controller = new AbortController(); detailsRequest.current = controller;
    const key = modelKey(model);
    setDetails({ id: key, text: t('Loading description…') });
    try {
      const result = await fetchModel(model.id, controller.signal, model.source);
      if (!controller.signal.aborted) setDetails(result.descriptionHtml?.trim()
        ? { id: key, text: result.description || '', html: result.descriptionHtml }
        : { id: key, text: result.description || t('No description available.') });
    } catch { if (!controller.signal.aborted) setDetails({ id: key, text: t('Could not load description. Try again.') }); }
  };
  const closeInfo = () => setInfoModel(undefined);
  const openInfo = (model: Model) => {
    setInfoModel(model);
    if (details?.id !== modelKey(model)) void fetchDescription(model);
  };
  return <section ref={browser} className="model-browser" aria-labelledby="models-title" aria-busy={status === 'loading'}>
    <header className="model-header"><h1 id="models-title" className="ds-title--page">{t('Models')}</h1>
    <p>{t('Discover models and open their original pages. Download files there, then import them in Prepare.')}</p>
    </header>
    <div className="model-controls">
    <form className="model-search" onSubmit={event => event.preventDefault()}>
      <div className="model-search-field">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg>
        <label className="ds-visually-hidden" htmlFor="model-search-input">{t('Search models')}</label>
        <input id="model-search-input" className="ds-input" type="search" placeholder={t('Search models…')} value={criteria.q || ''} onChange={event => change({ q: event.target.value })} />
        {criteria.q && <button type="button" className="model-search-clear" aria-label={t('Clear search')} onClick={() => change({ q: '' })}>×</button>}
      </div>
      <label>{t('Sort')}<select className="ds-select" value={criteria.sort} onChange={event => change({ sort: event.target.value as CatalogQuery['sort'] })}>
        {['newest', 'oldest', 'relevance', 'likes', 'downloads'].map(value => <option key={value} value={value}>{t(value)}</option>)}
      </select></label>
      <label>{t('Provider')}<select className="ds-select" value={criteria.source || ''} onChange={event => change({ source: (event.target.value || undefined) as CatalogQuery['source'] })}>
        <option value="">{t('All providers')}</option>
        <option value="makerworld">MakerWorld</option>
        <option value="printables">Printables</option>
      </select></label>
      <label>{t('Category')}<select className="ds-select" value={criteria.category || ''} onChange={event => change({ category: event.target.value })}>
        <option value="">{t('All categories')}</option>{stats?.categories.map(choice => <option key={choice.name}>{choice.name}</option>)}
      </select></label>
      <button className="ds-btn model-filter-toggle" type="button" aria-expanded={filtersOpen} aria-controls="model-advanced-panel" onClick={() => setFiltersOpen(value => !value)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d="M4 7h7m4 0h5M4 17h3m4 0h9" /><circle cx="13" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></svg>
        {t('Advanced filters')}{advancedCount > 0 && <span className="model-filter-count">{advancedCount}</span>}
      </button>
      <button className="ds-btn ds-btn--ghost" type="button" disabled={!hasFilters} onClick={() => { setCriteria(current => ({ page: 1, pageSize: current.pageSize, sort: 'newest' })); setDetails(undefined); detailsRequest.current?.abort(); }}>{t('Clear filters')}</button>
    </form>
    <div id="model-advanced-panel" className="model-advanced" hidden={!filtersOpen}><div className="model-filter-fields">
      {(['author', 'license', 'subcategory'] as const).map(key => <label key={key}>{t(key === 'author' ? 'Author (exact)' : key === 'license' ? 'License (exact)' : 'Subcategory (exact)')}<input className="ds-input" value={criteria[key] || ''} list={key === 'subcategory' ? undefined : `model-${key}`} onChange={event => change({ [key]: event.target.value })} />{key !== 'subcategory' && <datalist id={`model-${key}`}>{stats?.[key === 'author' ? 'authors' : 'licenses'].map(choice => <option key={choice.name} value={choice.name} />)}</datalist>}</label>)}
      <label>{t('Thumbnail')}<select className="ds-select" value={criteria.hasThumbnail === undefined ? '' : String(criteria.hasThumbnail)} onChange={event => change({ hasThumbnail: event.target.value === '' ? undefined : event.target.value === 'true' })}><option value="">{t('Any')}</option><option value="true">{t('With thumbnail')}</option><option value="false">{t('Without thumbnail')}</option></select></label>
    </div>
    <div className="model-range-fields">
      {([
        ['Likes', ['minLikes', 'Minimum likes'], ['maxLikes', 'Maximum likes']],
        ['Downloads', ['minDownloads', 'Minimum downloads'], ['maxDownloads', 'Maximum downloads']],
        ['Upload date', ['uploadedAfter', 'Uploaded after'], ['uploadedBefore', 'Uploaded before']],
      ] as const).map(([label, ...fields]) => <fieldset className="model-range" key={label}><legend>{t(label)}</legend><div>{fields.map(([key, name]) => <label key={key}><span className="ds-visually-hidden">{t(name)}</span><input className="ds-input" type={label === 'Upload date' ? 'date' : 'number'} aria-label={t(name)} placeholder={t(name)} min={label === 'Upload date' ? undefined : '0'} step={label === 'Upload date' ? undefined : '1'} value={criteria[key] ?? ''} onChange={event => change({ [key]: event.target.value === '' ? undefined : label === 'Upload date' ? event.target.value : Number(event.target.value) })} /></label>)}</div></fieldset>)}
    </div>
    <fieldset className="model-formats"><legend>{t('Verified file formats (match any)')}{!!criteria.formats?.length && <span className="model-filter-count">{criteria.formats.length}</span>}</legend><div className="model-format-list">{stats?.formats.map(choice => <label className="model-format-chip" key={choice.name}><input className="ds-visually-hidden" type="checkbox" checked={criteria.formats?.includes(choice.name) || false} onChange={event => change({ formats: event.target.checked ? [...(criteria.formats || []), choice.name] : criteria.formats?.filter(format => format !== choice.name) })} /><span>.{choice.name}</span></label>)}</div></fieldset></div>
    </div>
    <div className="model-results-bar">
    {statsError && <p>{t('Filter choices unavailable. Retry to load them.')} <button className="ds-btn" onClick={() => setRetry(value => value + 1)}>{t('Retry')}</button></p>}
    <div role="status" aria-live="polite">
      {status === 'loading' && t('Loading catalog…')}
      {status === 'error' && <p>{t('Could not load the catalog. Check your connection and retry.')} <button className="ds-btn" onClick={() => setRetry(value => value + 1)}>{t('Retry')}</button></p>}
      {status === 'ready' && (total ? t('{{count}} models', { count: total.toLocaleString() }) : t('No models found. Try another search or clear the filters.'))}
    </div>
    {hasFilters && <div className="model-active-filters">
      {activeFilters.map(key => <button className="model-active-filter" type="button" key={key} onClick={() => change({ [key]: undefined })} aria-label={t('Remove filter: {{filter}}', { filter: t(filterLabels[key]) })}>{t(filterLabels[key])}: {key === 'hasThumbnail' ? t(criteria.hasThumbnail ? 'With thumbnail' : 'Without thumbnail') : key === 'source' ? platformName(String(criteria.source)) : String(criteria[key])}<span aria-hidden="true">×</span></button>)}
      {criteria.formats?.map(format => <button className="model-active-filter" type="button" key={format} aria-label={t('Remove filter: {{filter}}', { filter: `.${format}` })} onClick={() => change({ formats: criteria.formats?.filter(value => value !== format) })}>.{format}<span aria-hidden="true">×</span></button>)}
      {criteria.sort !== 'newest' && <button className="model-active-filter" type="button" aria-label={t('Remove filter: {{filter}}', { filter: t('Sort') })} onClick={() => change({ sort: 'newest' })}>{t('Sort')}: {t(criteria.sort || 'newest')}<span aria-hidden="true">×</span></button>}
    </div>}
    {downloadStatus && <p role="status">{t(downloadStatus)}</p>}
    {opening && !infoModel && <span className="ds-visually-hidden" role="status">{openingLabel}</span>}
    </div>
    <div className="model-grid" ref={grid}>{models.map(model => <div key={modelKey(model)} className="model-cell"><a className="model-card" href={model.url} target="_blank" rel="noopener noreferrer"
      onClick={event => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); openInfo(model); }}>
      <div className="model-thumbnail"><Thumbnail url={model.thumbnail} /></div>
      <div className="model-card-copy"><h2>{model.title}</h2><ModelFacts model={model} compact /></div>
    </a><div className="model-card-actions">
      {model.source === 'printables' ? <>
        <a className="ds-btn ds-btn--sm ds-btn--primary model-card-open" href={model.url} target="_blank" rel="noopener noreferrer">{t('Open in {{platform}}', { platform: platformName(model.source) })}</a>
        <button className="ds-btn ds-btn--sm ds-btn--subtle" onClick={() => openInfo(model)}>{t('More info')}</button>
      </> : <>
        {openButton(model, 'ds-btn ds-btn--sm ds-btn--primary model-card-open')}
        <button className="ds-btn ds-btn--sm ds-btn--subtle" onClick={() => openInfo(model)}>{t('More info')}</button>
        <button className="ds-btn ds-btn--sm ds-btn--subtle" disabled={busy} onClick={() => void download(model)}>{t('Download 3MF')}</button>
      </>}
    </div></div>)}</div>
    {status === 'ready' && pages > 0 && <nav className="model-pagination" aria-label={t('Model pages')}><button className="ds-btn" disabled={(criteria.page || 1) <= 1} onClick={() => setCriteria(current => ({ ...current, page: (current.page || 1) - 1 }))}>{t('Previous')}</button><span>{t('Page {{page}} of {{pages}}', { page: criteria.page || 1, pages })}</span><button className="ds-btn" disabled={(criteria.page || 1) >= pages} onClick={() => {
      setCriteria(current => ({ ...current, page: (current.page || 1) + 1 }));
      if (browser.current) browser.current.scrollTop = 0;
    }}>{t('Next')}</button></nav>}
    {active && infoModel && <Dialog onClose={closeInfo} aria-labelledby="model-modal-title">
      <div className="model-detail">
        <header className="ds-dialog__head">
          <h2 id="model-modal-title">{infoModel.title}</h2>
          <button className="ds-btn ds-btn--sm ds-btn--subtle" type="button" onClick={closeInfo}>{t('Close')}</button>
        </header>
        <div className="ds-dialog__body">
          <div className="model-thumbnail model-detail-thumbnail"><Thumbnail url={infoModel.thumbnail} /></div>
          <div className="model-detail-copy">
            <ModelFacts model={infoModel} />
            {details?.id === modelKey(infoModel) && details.html
              ? <div className="model-modal-description model-modal-description--html">{renderedDescription || details.text || t('No description available.')}</div>
              : details?.id === modelKey(infoModel)
                ? <p className="model-modal-description">{details.text}</p>
                : <p className="model-modal-description" role="status">{t('Loading description…')}</p>}
            {downloadStatus && <p className="model-modal-status" role="status">{t(downloadStatus)}</p>}
          </div>
        </div>
        <footer className="ds-dialog__foot">
          <a className={`ds-btn ${infoModel.source === 'printables' ? 'ds-btn--primary' : 'ds-btn--subtle'}`} href={infoModel.url} target="_blank" rel="noopener noreferrer">{t('Open in {{platform}}', { platform: platformName(infoModel.source) })}</a>
          {infoModel.source !== 'printables' && <>
            <button className="ds-btn" disabled={busy} onClick={() => void download(infoModel)}>{t('Download 3MF')}</button>
            {openButton(infoModel, 'ds-btn ds-btn--primary')}
          </>}
          {opening && <span className="ds-visually-hidden" role="status">{openingLabel}</span>}
        </footer>
      </div>
    </Dialog>}
  </section>;
}
