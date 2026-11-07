import React, { useEffect, useRef, useState } from 'react';
import { confirmDialog } from '../components/ModalBackdrop';
import { usePrinterConnectionStore } from './connectionStore';
import { OctoEverywhereApi, type OctoEverywhereFile, type OctoEverywhereFileDetails, type OctoEverywhereStartOptions } from './octoEverywhere';
import type { PhysicalPrinter, PrinterState } from './types';
import { formatBytes, formatDuration } from './format';
import './OctoEverywhere.css';

const flatten = (files: OctoEverywhereFile[]): OctoEverywhereFile[] => files.flatMap(file => file.Type === 'folder' ? flatten(file.Children ?? []) : [file]);

export const OctoEverywherePanel: React.FC<{ printer: PhysicalPrinter; state: PrinterState | null; active: boolean }> = ({ printer, state, active }) => {
  const adapter = usePrinterConnectionStore(s => s.activeApi);
  const api = adapter instanceof OctoEverywhereApi ? adapter : undefined;
  const remote = state?.octoeverywhere;
  const caps = api?.capabilities;
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [root, setRoot] = useState('gcode');
  const [files, setFiles] = useState<OctoEverywhereFile[]>();
  const [details, setDetails] = useState<OctoEverywhereFileDetails>();
  const [path, setPath] = useState('');
  const [storage, setStorage] = useState('');
  const [options, setOptions] = useState<OctoEverywhereStartOptions>({});
  const [mapping, setMapping] = useState('');
  const [camera, setCamera] = useState(0);
  const [image, setImage] = useState<string>();
  const [streaming, setStreaming] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const stopStream = useRef<() => void>(() => {});
  const imageTimer = useRef<ReturnType<typeof setTimeout>>();
  const cameraEpoch = useRef(0);
  const [hours, setHours] = useState(1);
  const [endWithPrint, setEndWithPrint] = useState(true);
  const [liveLink, setLiveLink] = useState<string>();
  const [webhook, setWebhook] = useState('');
  const [events, setEvents] = useState('');
  const epoch = useRef(0);
  useEffect(() => () => { epoch.current++; }, [api]);
  const stopCamera = () => {
    cameraEpoch.current++;
    stopStream.current(); stopStream.current = () => {};
    clearTimeout(imageTimer.current);
    imageRef.current?.removeAttribute('src'); setImage(undefined); setStreaming(false);
  };
  useEffect(() => { stopCamera(); return stopCamera; }, [api, camera, active]); // eslint-disable-line react-hooks/exhaustive-deps
  const isCurrent = () => !!api && usePrinterConnectionStore.getState().activeApi === api;
  const run = async (action: (api: OctoEverywhereApi) => Promise<void>) => {
    if (!api || busy || !isCurrent()) return;
    const generation = epoch.current;
    setBusy(true); setMessage('');
    try { await action(api); }
    catch { if (generation === epoch.current) setMessage('OctoEverywhere could not complete this action. Check the connection, account limits and printer, then try again.'); }
    finally { if (generation === epoch.current) setBusy(false); }
  };
  const confirm = async (title: string, message: string, label: string) =>
    await confirmDialog({ title, message, confirmLabel: label, cancelLabel: 'Cancel' }) && isCurrent();
  const refresh = async (client: OctoEverywhereApi) => {
    const result = await client.listFiles(root);
    if (isCurrent()) setFiles(flatten(result));
  };
  const start = () => run(async client => {
    if (!await confirm('Start print?', `Start ${path} on ${printer.name}? Check the build plate and loaded material.`, 'Start print')) return;
    const isBambu = printer.host_type === 'bambu' || printer.host_type === 'bambu-cloud';
    const startOptions: OctoEverywhereStartOptions = isBambu
      ? { UseAms: false, FlowCali: false, Timelapse: false, BedLeveling: false, VibrationCali: false, LayerInspect: false, ...options }
      : storage.trim() ? { Storage: storage.trim() } : {};
    if (mapping.trim()) {
      if (!/^\d+(\s*,\s*\d+)*$/.test(mapping)) throw new Error('mapping');
      startOptions.AmsMapping = mapping.split(',').map(Number);
    }
    await client.startFile(path, startOptions); setMessage('Print start requested.');
  });
  const selectedCamera = remote?.cameras.find(c => c.index === camera);
  const takeCamera = (stream: boolean) => run(async client => {
    stopCamera();
    const generation = cameraEpoch.current;
    const closed = () => { imageRef.current?.removeAttribute('src'); setImage(undefined); setStreaming(false); };
    if (stream) {
      const result = await client.openCameraStream(camera, closed);
      if (generation !== cameraEpoch.current || !active) { result.close(); return; }
      stopStream.current = result.close; setImage(result.url); setStreaming(true);
    } else {
      const result = await client.getSnapshot(camera);
      if (generation !== cameraEpoch.current || !active) return;
      setImage(result.url);
      imageTimer.current = setTimeout(closed, Math.max(0, result.expiresAt - Date.now()));
    }
  });
  const limits = remote?.info?.PrinterLimits;
  const material = remote?.materialSystem;
  const bambu = printer.host_type === 'bambu' || printer.host_type === 'bambu-cloud';
  return <div className="oe-panel oe-remote" aria-label="OctoEverywhere remote tools" aria-busy={busy}>
    <h4>Remote printer</h4>
    <p>{remote?.health ?? 'unknown'} · {remote?.recovery ? `Recovery: ${remote.recovery}` : 'OctoEverywhere connection'}</p>
    {remote?.gadget && <p>Gadget: {remote.gadget.Status || `State ${remote.gadget.State}`}{remote.gadget.Rating != null ? ` · Rating ${remote.gadget.Rating}` : ''}</p>}
    <details><summary>Connection limits</summary><dl>
      <dt>Upload</dt><dd>{limits?.MaxUploadFileSizeBytes == null ? 'Unknown' : formatBytes(limits.MaxUploadFileSizeBytes)}</dd>
      <dt>Download</dt><dd>{limits?.MaxDownloadFileSizeBytes == null ? 'Unknown' : formatBytes(limits.MaxDownloadFileSizeBytes)}</dd>
      <dt>Camera stream</dt><dd>{limits?.MaxSingleWebcamStreamLengthSeconds == null ? 'Unknown; streams are bounded' : formatDuration(limits.MaxSingleWebcamStreamLengthSeconds)}</dd>
    </dl><p>Account and plugin capabilities determine available operations. Reconnect in printer settings after renewing authorization.</p></details>
    {caps?.lights && remote?.lights?.map(light => <div className="oe-actions" key={light.Name}><span>{light.Name}: {light.On == null ? 'Unknown' : light.On ? 'On' : 'Off'}</span>
      <button className="ds-btn" disabled={busy} onClick={() => run(client => client.setLight(light.Name, true))}>Turn on</button>
      <button className="ds-btn" disabled={busy} onClick={() => run(client => client.setLight(light.Name, false))}>Turn off</button></div>)}
    <details><summary>Material and tools</summary>
      {!material ? <p>Material topology unavailable.</p> : <>
        {material.Tools?.map(tool => <p key={tool.Id}>{tool.Name || tool.Id}{tool.IsActive ? ' · Active' : ''} · {tool.ActualCelsius ?? 'Unknown'} / {tool.TargetCelsius ?? 'Unknown'} °C</p>)}
        {material.Sources?.map(source => {
          const unit = material.Units?.find(unit => unit.Id === source.UnitId);
          const routes = material.Routes?.filter(route => route.SourceId === source.Id);
          return <div className="oe-file" key={source.Id}>{source.Name || source.Id} · {source.IsEmpty === true ? 'Empty' : source.IsEmpty === false ? 'Present' : 'Presence unknown'}
            <p>{source.Material?.Name || source.Material?.Type || 'Unknown material'}{source.Material?.ColorHex ? ` · ${source.Material.ColorHex}` : ''}{source.Material?.RemainingPercent != null ? ` · ${source.Material.RemainingPercent}% remaining` : ''}</p>
            {unit && <p>{unit.Name || unit.Id} · Humidity {unit.HumidityPercent ?? 'Unknown'}% · {unit.TemperatureCelsius ?? 'Unknown'} °C{unit.IsDrying == null ? '' : unit.IsDrying ? ' · Drying' : ' · Not drying'}</p>}
            {routes?.map(route => <p key={route.ToolId}>→ {material.Tools?.find(tool => tool.Id === route.ToolId)?.Name || route.ToolId} · {route.State || 'Route state unknown'}</p>)}
            {source.PrintMappingValue != null && <p>AMS mapping value: {source.PrintMappingValue}</p>}
          </div>;
        })}
      </>}
    </details>
    {!!remote?.cameras.length && <details className="oe-camera" onToggle={event => { if (!event.currentTarget.open) stopCamera(); }}><summary>Cameras</summary>
      <label>Camera<select className="ds-select" aria-label="Camera" value={camera} onChange={event => setCamera(Number(event.target.value))}>{remote.cameras.map(cam => <option key={cam.index} value={cam.index} disabled={cam.enabled === false}>{cam.name}{cam.enabled === false ? ' (disabled)' : ''}</option>)}</select></label>
      <div className="oe-actions"><button className="ds-btn" disabled={busy || !active || selectedCamera?.enabled === false} onClick={() => takeCamera(false)}>Snapshot</button>
        <button className="ds-btn" disabled={busy || !active || selectedCamera?.enabled === false} onClick={() => takeCamera(true)}>{streaming ? 'Reconnect stream' : 'Start stream'}</button>
        <button className="ds-btn" onClick={stopCamera}>Stop camera</button></div>
      <p>Streams expire at the account limit. Reconnect explicitly when a stream stops.</p>
      {image && <div className="oe-camera-view"><img ref={imageRef} src={image} alt={selectedCamera?.name || 'Printer camera'} referrerPolicy="no-referrer" onError={stopCamera} onLoad={() => { if (streaming) stopCamera(); }}
        style={{ transform: `rotate(${selectedCamera?.rotation ?? 0}deg) scale(${selectedCamera?.flipH ? -1 : 1}, ${selectedCamera?.flipV ? -1 : 1})` }} /></div>}
    </details>}
    <details><summary>Printer files</summary>
      {caps?.files ? <>
        <label>File root<select className="ds-select" value={root} onChange={event => { setRoot(event.target.value); setFiles(undefined); setDetails(undefined); }}>{caps.fileRoots.list.map(item => <option key={item}>{item}</option>)}</select></label>
        <button className="ds-btn" disabled={busy} onClick={() => run(refresh)}>Refresh files</button>
        <p>{files === undefined ? 'Refresh to load printer files.' : files.length === 0 ? 'No files in this root.' : `${files.length} files`}</p>
        {files?.map(file => <div className="oe-file" key={file.VirtualPath}>
          <strong>{file.Name}</strong><p>{file.VirtualPath} · {file.SizeBytes == null ? 'Unknown size' : formatBytes(file.SizeBytes)}</p>
          <div className="oe-actions">
            {caps.fileRoots.details.includes(root) && <button className="ds-btn" disabled={busy} onClick={() => run(async client => { const result = await client.getFileDetails(file.VirtualPath); if (isCurrent()) setDetails(result); })}>Details</button>}
            {caps.fileRoots.download.includes(root) && <button className="ds-btn" disabled={busy} onClick={() => run(async client => {
              const blob = await client.downloadFile(file.VirtualPath); if (!isCurrent()) return;
              const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = file.Name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
            })}>Download</button>}
            {caps.fileRoots.delete.includes(root) && <button className="ds-btn" disabled={busy} onClick={() => run(async client => {
              if (await confirm('Delete file?', `Delete ${file.VirtualPath} from ${printer.name}?`, 'Delete file')) { await client.deleteFile(file.VirtualPath); await refresh(client); }
            })}>Delete</button>}
            {root === 'gcode' && caps.start && <button className="ds-btn" disabled={busy || (bambu && !/\.3mf$/i.test(file.VirtualPath))} onClick={() => setPath(file.VirtualPath)}>Select for print</button>}
          </div>
        </div>)}
        {details && <dl aria-label="File details"><dt>Virtual path</dt><dd>{details.VirtualPath}</dd><dt>Platform path</dt><dd>{details.PlatformPath || 'Unknown'}</dd>
          <dt>Size</dt><dd>{details.SizeBytes == null ? 'Unknown' : formatBytes(details.SizeBytes)}</dd><dt>Estimated time</dt><dd>{details.EstPrintTimeSec == null ? 'Unknown' : formatDuration(details.EstPrintTimeSec)}</dd>
          <dt>Layers / material</dt><dd>{details.LayerCount ?? 'Unknown'} / {details.FilamentName || details.FilamentType || 'Unknown'}</dd>
          {details.ModifiedTimeSec != null && <><dt>Modified</dt><dd>{new Date(details.ModifiedTimeSec * 1000).toLocaleString()}</dd></>}
          {details.EstFilamentUsedMm != null && <><dt>Estimated filament</dt><dd>{details.EstFilamentUsedMm} mm</dd></>}
          {details.EstFilamentWeightMg != null && <><dt>Estimated material weight</dt><dd>{details.EstFilamentWeightMg / 1000} g</dd></>}
          {details.LayerHeightMm != null && <><dt>Layer height</dt><dd>{details.LayerHeightMm} mm</dd></>}
          {details.FirstLayerHeightMm != null && <><dt>First layer height</dt><dd>{details.FirstLayerHeightMm} mm</dd></>}
          {details.ObjectHeightMm != null && <><dt>Object height</dt><dd>{details.ObjectHeightMm} mm</dd></>}
          {details.NozzleDiameterMm != null && <><dt>Nozzle diameter</dt><dd>{details.NozzleDiameterMm} mm</dd></>}
          {(details.Slicer || details.SlicerVersion) && <><dt>Slicer</dt><dd>{details.Slicer || 'Unknown'} {details.SlicerVersion}</dd></>}
          {details.HotendTempC != null && <><dt>Tool temperature</dt><dd>{details.HotendTempC} °C</dd></>}
          {details.BedTempC != null && <><dt>Bed temperature</dt><dd>{details.BedTempC} °C</dd></>}
          {details.ChamberTempC != null && <><dt>Chamber temperature</dt><dd>{details.ChamberTempC} °C</dd></>}
        </dl>}
        {caps.fileRoots.upload.includes(root) && <label>Upload file only<input type="file" disabled={busy} onChange={event => {
          const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
          void run(async client => { const result = await client.uploadFile(`${root}/${file.name}`, new Uint8Array(await file.arrayBuffer())); if (!isCurrent()) return; setPath(result.VirtualPath); setMessage('Uploaded. Review print options before starting.'); await refresh(client); });
        }} /></label>}
      </> : <p>Common file browsing and transfers are unavailable for this host or plugin. {printer.host_type === 'prusalink' ? 'You can start an existing printer path below when supported.' : 'Use the printer’s own app.'}</p>}
      {caps?.start && <>
        <label>Existing virtual path<input className="ds-input" value={path} onChange={event => setPath(event.target.value)} placeholder={bambu ? 'gcode/compatible-project.3mf' : 'gcode/filename.gcode'} /></label>
        {printer.host_type === 'prusalink' && <label>Storage (optional)<input className="ds-input" value={storage} onChange={event => setStorage(event.target.value)} /></label>}
        {bambu && <><p>Printing requires a compatible Bambu 3MF project. Raw G-code is not a project package. Choose the plate and material mapping deliberately.</p>
          <div className="oe-options"><label>Plate (optional)<input className="ds-input" type="number" min="1" value={options.Plate ?? ''} onChange={event => setOptions({ ...options, Plate: event.target.value ? Number(event.target.value) : undefined })} /></label>
            {(['UseAms', 'FlowCali', 'Timelapse', 'BedLeveling', 'VibrationCali', 'LayerInspect'] as const).map(key => <label key={key}><input type="checkbox" checked={options[key] ?? false} onChange={event => setOptions({ ...options, [key]: event.target.checked })} />{({ UseAms: 'Use AMS', FlowCali: 'Flow calibration', Timelapse: 'Timelapse', BedLeveling: 'Bed leveling', VibrationCali: 'Vibration calibration', LayerInspect: 'Layer inspection' })[key]}</label>)}
          </div><label>AMS mapping values (comma separated)<input className="ds-input" value={mapping} onChange={event => setMapping(event.target.value)} placeholder="Use reported material mapping values" /></label></>}
        <button className="ds-btn" disabled={busy || !path.trim() || (bambu && !/\.3mf$/i.test(path))} onClick={start}>Start print…</button>
      </>}
    </details>
    <details><summary>Sharing and notifications</summary>
      <p>Live Links grant temporary access to this printer. Create a link only when you intend to share it.</p>
      <label>Expiration (hours)<input className="ds-input" type="number" min="1" max="24" value={hours} onChange={event => setHours(Number(event.target.value))} /></label>
      <label><span><input type="checkbox" checked={endWithPrint} onChange={event => setEndWithPrint(event.target.checked)} /> End when the current print finishes</span></label>
      {endWithPrint && <p>The current print determines expiration. After it finishes, the link becomes a static print result page.</p>}
      <button className="ds-btn" disabled={busy || hours < 1 || hours > 24} onClick={() => run(async client => {
        if (!await confirm('Create temporary Live Link?', 'Anyone with this link can access the shared printer until it expires.', 'Create Live Link')) return;
        const result = await client.createLiveLink({ ExpirationHours: hours, EndWhenCurrentPrintIsComplete: endWithPrint });
        if (isCurrent()) { setLiveLink(result.ShortUrl || result.Url); setMessage('Temporary Live Link created. Copy it to share.'); }
      })}>Create temporary Live Link</button>
      {liveLink && <button className="ds-btn" onClick={() => run(async () => { await navigator.clipboard.writeText(liveLink); setMessage('Live Link copied.'); })}>Copy Live Link</button>}
      <p>Notifications require a publicly reachable HTTPS callback receiver. A private or Tailscale address is insufficient. Renew registration within 180 days. WebOrca does not host the receiver or browser push notifications.</p>
      <label>HTTPS callback URL<input className="ds-input" type="password" autoComplete="off" value={webhook} onChange={event => setWebhook(event.target.value)} /></label>
      <label>Inclusive event types (comma separated IDs; empty means all)<input className="ds-input" value={events} onChange={event => setEvents(event.target.value)} /></label>
      <div className="oe-actions"><button className="ds-btn" disabled={busy || !webhook.startsWith('https://') || (!!events && !/^\d+(\s*,\s*\d+)*$/.test(events))} onClick={() => run(async client => {
        if (await confirm('Set notification webhook?', 'Send printer events to the supplied public callback. Renew it within 180 days.', 'Set webhook')) {
          await client.setNotificationWebhook({ WebhookUrl: webhook, ...(events.trim() ? { InclusiveEventTypesFilter: events.split(',').map(Number) } : {}) }); setWebhook(''); setMessage('Webhook registered. Renew within 180 days.');
        }
      })}>Set webhook</button>
        <button className="ds-btn" disabled={busy} onClick={() => run(async client => { if (await confirm('Delete notification webhook?', 'Stop sending printer events to the registered callback?', 'Delete webhook')) { await client.deleteNotificationWebhook(); setMessage('Webhook deleted.'); } })}>Delete webhook</button>
        <button className="ds-btn" disabled={busy} onClick={() => run(async client => { if (await confirm('Send test notification?', 'Deliver a test event to the registered public callback?', 'Send test')) { await client.testNotificationWebhook(); setMessage('Test notification requested.'); } })}>Test webhook</button>
      </div>
    </details>
    {message && <p role="status">{message}</p>}
  </div>;
};
