import React from 'react';
import { useAppStore } from '../store/appStore';
import { usePlatesStore } from '../plates/platesStore';
import { useTranslation } from '../i18n';
import { formatPrintTime } from './SliceStatsPanel';
import '../shell/workflow.css';

export function OutputReview() {
  const { t } = useTranslation();
  const result = useAppStore(s => s.sliceResult);
  const p = usePlatesStore();
  if (!result || result.plateIndex !== p.activePlateIndex) return null;
  return <div className="workflow-review">
    <strong>{p.plates.find(plate => plate.index === result.plateIndex)?.name}</strong>
    <p>{formatPrintTime(result.printTimeS)} · {result.filamentG.toFixed(2)} g</p>
    {result.provenance ? <p>{result.provenance.printer} · {result.provenance.nozzle} mm<br />{result.provenance.filaments.join(', ')}</p> : <p>{t('Printer and material metadata unavailable for this G-code.')}</p>}
    <p>{t('Download saves a file. Send opens delivery options; starting a print requires confirmation.')}</p>
  </div>;
}
