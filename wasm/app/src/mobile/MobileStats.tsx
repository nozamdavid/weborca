import React from 'react';
import { useTranslation } from '../i18n';
import { useAppStore } from '../store/appStore';
import { usePreviewStore } from '../preview/previewStore';
import { formatFilamentLength, formatPrintTime, parseFilamentCost, parseFilamentStats } from '../preview/SliceStatsPanel';
import { usePrinterConnectionStore } from '../printers/connectionStore';
import { usePlatesStore } from '../plates/platesStore';

/** Live preview statistics; download remains in the sheet's persistent footer. */
export function MobileStats() {
  const { t } = useTranslation();
  const stats = usePreviewStore(s => s.stats);
  const result = useAppStore(s => s.sliceResult);
  const filaments = useAppStore(s => s.selectedFilaments);
  const config = useAppStore(s => s.currentConfig);
  const model = useAppStore(s => s.modelFile);
  const printer = useAppStore(s => s.selectedPrinter);
  const process = useAppStore(s => s.selectedProcess);
  const slicing = useAppStore(s => s.isSlicing);
  const plate = usePlatesStore(s => s.activePlateIndex);
  const openSend = usePrinterConnectionStore(s => s.openSendDialog);
  if (!stats) return <p>{t('No slicing statistics available')}</p>;
  const raw = /\.(gcode|gco|bgcode)$/i.test(model?.name ?? '');
  const used = raw ? [] : parseFilamentStats(result?.gcode, filaments, config);
  const tail = result?.gcode ? new TextDecoder().decode(result.gcode.subarray(Math.max(0, result.gcode.length - 65536))) : '';
  const hasCost = /;\s*total filament cost\s*=\s*[0-9.]+/.test(tail);
  const canSend = !!result?.gcode?.length && !slicing && (result.plateIndex ?? plate) === plate;
  return <div className="mp-sheet" id="mobile-preview-stats">
    <p>{model?.name} · {t('Plate')} {plate + 1}</p>
    <dl className="mp-metrics">
      {[
        ['Total Layers', stats.layers], ['Print Time', formatPrintTime(stats.timeS)],
        ['Filament Length', formatFilamentLength(stats.filamentMm)], ['Filament Weight', `${stats.filamentG.toFixed(2)} g`],
        ['Filament Cost', hasCost ? parseFilamentCost(result?.gcode).toFixed(2) : '—'],
      ].map(([label, value]) => <div key={label}><dt>{t(String(label))}</dt><dd>{value}</dd></div>)}
    </dl>
    {used.length > 0 && <section><h2>{t('Used filaments')}</h2>{used.map(item => <div key={item.slot}>
      <p><span className="mp-swatch" style={{ background: item.color }} aria-hidden="true" /> #{item.slot} {item.name}</p>
      <small>{formatFilamentLength(item.mm)} ({item.g.toFixed(2)} g)</small>
    </div>)}</section>}
    {raw && <p>{t('Statistics from the loaded G-code. Slice settings and filament presets may be unavailable.')}</p>}
    <details open><summary>{t('Time by Feature')}</summary>{stats.features?.map((feature, index) => <div className="mp-feature" key={index}>
      <span>{feature.name}</span><span>{formatPrintTime(feature.timeS)}</span><span>{feature.percent.toFixed(1)}%</span>
    </div>)}</details>
    {!raw && result && <section><h2>{t('Slice settings')}</h2><p>{printer}</p><p>{process}</p>
      {result.warnings.length ? result.warnings.map((warning, i) => <p key={i}>{warning}</p>) : <p>{t('No slicing warnings')}</p>}
    </section>}
    {!result && <p role="status">{t('Slice result is outdated. Please re-slice.')}</p>}
    <button disabled={!canSend} onClick={openSend}>{t('Send to printer')}</button>
  </div>;
}
