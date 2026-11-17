/// <reference types="vite/client" />
import React, { useEffect, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog';
import { usePlateStore } from '../plate/plateStore';
import { useObjectListStore } from '../objectlist/objectListStore';
import { useHistoryStore } from '../history/historyStore';
import { getEngine } from '../engine/orcaEngine';
import { refreshAndCommit, stopConflictingTools, useEditOpsStore } from './editOpsStore';
import { useTranslation } from '../i18n';
import { useAppStore } from '../store/appStore';

const bundledTextures = Object.entries(import.meta.glob('../../../../resources/textures/displacement/*.png', { eager: true, query: '?url', import: 'default' }))
  .map(([path, url]) => ({ name: path.split('/').pop()!.replace(/\.png$/, ''), url: url as string }))
  .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export const TextureDialog: React.FC = () => {
  const active = useEditOpsStore(s => s.activeDialog === 'texture');
  return active ? <TextureForm /> : null;
};

const TextureForm: React.FC = () => {
  const { t } = useTranslation();
  const [target] = useState(() => {
    const objectId = usePlateStore.getState().selectedObjectId;
    const tree = useObjectListStore.getState();
    const object = tree.objects.find(o => o.id === objectId);
    const volume = object?.volumes.find(v => v.id === tree.selectedVolumeId) ??
      (object?.volumes.length === 1 ? object.volumes[0] : undefined);
    return { objectId, volumeId: volume?.id, name: volume?.name ?? object?.name };
  });
  const [image, setImage] = useState<number[] | null>(null);
  const [preview, setPreview] = useState('');
  const [filename, setFilename] = useState('');
  const [depth, setDepth] = useState(0.4);
  const [tileSize, setTileSize] = useState(12.5);
  const [rotation, setRotation] = useState(0);
  const [midlevel, setMidlevel] = useState(0);
  const [projection, setProjection] = useState(0);
  const [invert, setInvert] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [baked, setBaked] = useState(false);
  const [selectedTexture, setSelectedTexture] = useState('Bark');
  const request = useRef(0);
  useEffect(() => {
    void selectBundled(bundledTextures[0]);
    return () => { request.current++; };
  }, []);
  const busy = useEditOpsStore(s => s.isOperating);
  const close = () => { if (!busy && !loading) useEditOpsStore.setState({ activeDialog: null }); };
  const valid = Number.isFinite(depth) && depth > 0 && depth <= 5 &&
    Number.isFinite(tileSize) && tileSize >= 0.5 && tileSize <= 1000 &&
    Number.isFinite(rotation) && Number.isFinite(midlevel) && midlevel >= 0 && midlevel <= 1;

  async function upload(file?: File) {
    const generation = ++request.current;
    setSelectedTexture('');
    setImage(null); setPreview(''); setFilename(''); setError('');
    if (!file) return;
    setLoading(true);
    let bitmap: ImageBitmap | undefined;
    try {
      if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 8 * 1024 * 1024)
        throw new Error('Choose a PNG or JPEG smaller than 8 MB.');
      bitmap = await createImageBitmap(file);
      if (bitmap.width > 2048 || bitmap.height > 2048)
        throw new Error('Texture dimensions must be at most 2048 × 2048 pixels.');
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Image decoding is unavailable in this browser.');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Cannot read image.')), 'image/png'));
      if (blob.size > 8 * 1024 * 1024) throw new Error('Decoded texture is too large. Choose a smaller image.');
      const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
      if (generation !== request.current) return;
      setImage(bytes);
      setPreview(canvas.toDataURL()); setFilename(file.name);
    } catch (e) { if (generation === request.current) setError(e instanceof Error ? e.message : 'Cannot decode image. Choose another PNG or JPEG.'); }
    finally { bitmap?.close(); if (generation === request.current) setLoading(false); }
  }

  async function selectBundled(texture: { name: string; url: string }) {
    const generation = ++request.current;
    setSelectedTexture(texture.name); setImage(null); setPreview(''); setFilename(''); setError(''); setLoading(true);
    try {
      const response = await fetch(texture.url);
      if (!response.ok) throw new Error('Cannot load texture. Choose it again or upload a PNG or JPEG.');
      const bytes = Array.from(new Uint8Array(await response.arrayBuffer()));
      if (generation !== request.current) return;
      setImage(bytes); setPreview(texture.url); setFilename(texture.name);
    } catch (e) {
      if (generation === request.current) setError(e instanceof Error ? e.message : 'Cannot load texture.');
    } finally { if (generation === request.current) setLoading(false); }
  }

  async function bake() {
    if (busy || loading || !valid || !image || target.objectId == null || target.volumeId == null || useHistoryStore.getState().isRestoring) return;
    useEditOpsStore.setState({ isOperating: true }); setError('');
    let geometryChanged = baked;
    try {
      if (!geometryChanged) {
        await stopConflictingTools();
        const engine = await getEngine();
        const result = await engine.call('textureDisplace', { ...target, image, depth, tileSize, rotation, midlevel, projection, invert });
        if (!result.success) throw new Error(result.error ?? 'Texture bake failed.');
        geometryChanged = true;
        setBaked(true);
        useAppStore.getState().invalidateSlicePreview();
      }
      await refreshAndCommit('Bake texture displacement', [target.objectId], target.objectId);
      useEditOpsStore.setState({ activeDialog: null });
    } catch (e) {
      const detail = e instanceof Error ? e.message : 'Update failed.';
      setError(geometryChanged
        ? `The geometry was baked, but updating the scene or saving Undo history failed. Retry update to finish without baking again. ${detail}`
        : detail);
    }
    finally { useEditOpsStore.setState({ isOperating: false }); }
  }

  return <Dialog onClose={close} aria-label={t('Texture displacement')}>
    <div className="modal-content ds-dialog" data-testid="texture-dialog">
      <header className="ds-dialog__head"><h2>{t('Texture displacement')}</h2></header>
      <div className="ds-dialog__body" style={{ display: 'grid', gap: 12 }}>
        <p>{target.name}</p>
        <p>Bake image relief onto the entire selected part. Black is zero height; white is full depth. The bake replaces geometry and can be undone.</p>
        {target.volumeId == null && <p role="alert">Select one model part in the object list before opening this tool.</p>}
        <fieldset disabled={busy || loading || baked} style={{ display: 'grid', gap: 12, border: 0, padding: 0 }}>
          <div role="group" aria-label="Bundled height textures" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gridAutoRows: 'minmax(108px, auto)', gap: 8, maxHeight: 240, overflowY: 'auto' }}>
            {bundledTextures.map(texture => <button type="button" key={texture.name} className="ds-btn" aria-pressed={selectedTexture === texture.name}
              onClick={() => void selectBundled(texture)} style={{ display: 'flex', flexDirection: 'column', whiteSpace: 'normal', height: 'auto', padding: 4 }}>
              <img src={texture.url} alt="" loading="lazy" width="64" height="64" style={{ maxWidth: '100%', objectFit: 'contain' }} /><span>{texture.name}</span>
            </button>)}
          </div>
          <label>Height texture (PNG or JPEG)<input type="file" accept="image/png,image/jpeg" onChange={e => void upload(e.target.files?.[0])} /></label>
          {preview && <figure style={{ margin: 0 }}><img src={preview} alt="Height texture" style={{ maxWidth: '100%', width: 120, maxHeight: 120, objectFit: 'contain' }} /><figcaption>{filename}</figcaption></figure>}
          <label>Depth (mm)<input type="number" min="0" max="5" step="0.1" value={depth} onChange={e => setDepth(e.target.valueAsNumber)} /></label>
          <label>Tile size (mm)<input type="number" min="0.5" max="1000" step="0.5" value={tileSize} onChange={e => setTileSize(e.target.valueAsNumber)} /></label>
          <label>Rotation (°)<input type="number" value={rotation} onChange={e => setRotation(e.target.valueAsNumber)} /></label>
          <label>Neutral height (0–1)<input type="number" min="0" max="1" step="0.1" value={midlevel} onChange={e => setMidlevel(e.target.valueAsNumber)} /></label>
          <label>Projection<select value={projection} onChange={e => setProjection(Number(e.target.value))}><option value="0">Triplanar</option><option value="1">Cylindrical</option><option value="2">Spherical</option></select></label>
          <label><input type="checkbox" checked={invert} onChange={e => setInvert(e.target.checked)} /> Invert displacement direction</label>
        </fieldset>
        {(invert || midlevel > 0) && <p>Inward relief can intersect thin walls. Inspect the result before slicing.</p>}
        {!valid && <p role="alert">Use depth above 0 and up to 5 mm, tile size 0.5–1000 mm and neutral height 0–1.</p>}
        {error && <p role="alert" className="error-message">{error}</p>}
        <p role="status">{busy ? 'Baking texture…' : loading ? 'Reading texture…' : 'One unpainted part, one instance. UV-mapped parts are not supported. Output is limited to 200,000 triangles.'}</p>
      </div>
      <footer className="ds-dialog__foot"><button className="ds-btn" disabled={busy || loading} onClick={close}>{t(baked ? 'Close' : 'Cancel')}</button><button className="ds-btn ds-btn--primary" disabled={busy || loading || !image || !valid || target.volumeId == null} onClick={() => void bake()}>{baked ? 'Retry update' : 'Bake texture'}</button></footer>
    </div>
  </Dialog>;
};
