import React from 'react';
import { usePlatesStore } from '../plates/platesStore';
import { useAppStore } from '../store/appStore';
import { useSliceReadiness } from './sliceReadiness';
import { useTranslation } from '../i18n';
import './workflow.css';
import { plateResultState } from '../plates/resultState';
import { batchZip } from '../plates/batchOutput';
export function PlateScope() {
  const { t } = useTranslation();
  const p = usePlatesStore();
  const result = useAppStore(s => s.sliceResult);
  const reason = useSliceReadiness();
  const batch = p.batch;
  const activePlate = p.plates.find(plate => plate.index === p.activePlateIndex);
  const showBatch = p.plates.filter(plate => plate.instances.length > 0).length > 1 || !!batch;
  const complete = !!batch && batch.outputs.length === batch.total && !batch.running;
  const download = () => {
    if (!batch?.outputs.length) return;
    const url = URL.createObjectURL(new Blob([batchZip(batch.outputs) as BlobPart], { type: 'application/zip' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = complete ? 'all-plates-gcode.zip' : 'partial-completed-plates-gcode.zip';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="workflow-scope">
    <strong>{activePlate?.name}</strong>{activePlate && <span> · {t(plateResultState(activePlate.instances.length, result?.plateIndex, activePlate.index, !!result?.gcode.length))}</span>}
    {showBatch && <details><summary>{t('Slice all plates')}</summary>
      <ul>{p.plates.map(plate => <li key={plate.index}>{plate.name} · {t(plateResultState(plate.instances.length, result?.plateIndex, plate.index, !!result?.gcode.length))}{batch?.outputs.some(output => output.plateIndex === plate.index) ? ` · ${t('Included in ZIP')}` : ''}</li>)}</ul>
      <button className="ds-btn" disabled={!!reason || p.isLoading || batch?.running} onClick={() => void p.sliceAll()}>{t('Slice all plates')}</button>
    </details>}
    {!!batch?.outputs.length && <>
      <p role="status">{batch.outputs.length}/{batch.total} · {t(complete ? 'All plate outputs completed' : 'Partial archive: completed plates only')}</p>
      <button className="ds-btn" disabled={batch.running} onClick={download}>{t(complete ? 'Download all plate G-code ZIP' : 'Download completed plate G-code ZIP')}</button>
    </>}
  </div>;
}
