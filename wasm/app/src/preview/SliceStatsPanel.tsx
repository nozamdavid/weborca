import './SliceStatsPanel.css';
import { usePlatesStore } from '../plates/platesStore';
/**
 * @file SliceStatsPanel.tsx
 * Floating statistics panel showing slice print time, layers, moves,
 * filament usage, and feature breakdown matching desktop OrcaSlicer.
 */

import React, { useState, useMemo } from 'react';
import { usePreviewStore } from './previewStore';
import { useAppStore } from '../store/appStore';
import { usePrinterConnectionStore } from '../printers/connectionStore';
import { SendToPrinterDialog } from '../printers/SendToPrinterDialog';
import { exportGcode } from '../shell/exportGcode';
import { useTranslation } from "../i18n";
import { OutputReview } from './OutputReview';
import { hasPlateOutput } from '../plates/resultState';

export function formatPrintTime(seconds: number): string {
  if (!seconds || seconds <= 0) return '0s';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

interface SlotFilamentStat {
  slot: number;
  name: string;
  color: string;
  mm: number;
  g: number;
}

export function parseFilamentStats(
  gcodeBytes: Uint8Array | undefined,
  selectedFilaments: string[],
  currentConfig: Record<string, string>
): SlotFilamentStat[] {
  if (!selectedFilaments?.length) return [];

  const rawColors = (currentConfig['filament_colour'] || '')
    .split(';')
    .map((c) => c.trim())
    .map((c) => {
      if (!c) return '';
      let hex = c.startsWith('#') ? c : `#${c}`;
      return hex.length > 7 ? hex.slice(0, 7) : hex;
    });

  let mmValues: number[] = [];
  let gValues: number[] = [];

  if (gcodeBytes && gcodeBytes.length > 0) {
    const offset = Math.max(0, gcodeBytes.length - 65536);
    const tail = new TextDecoder('utf-8', { fatal: false }).decode(gcodeBytes.subarray(offset));

    const mmMatch = tail.match(/;\s*filament used \[mm\]\s*=\s*([0-9., ]+)/);
    const gMatch = tail.match(/;\s*filament used \[g\]\s*=\s*([0-9., ]+)/);

    if (mmMatch) {
      mmValues = mmMatch[1].split(',').map((s) => parseFloat(s.trim()) || 0);
    }
    if (gMatch) {
      gValues = gMatch[1].split(',').map((s) => parseFloat(s.trim()) || 0);
    }
  }

  return selectedFilaments.map((name, idx) => {
    return {
      slot: idx + 1,
      name,
      color: rawColors[idx] || 'var(--accent)',
      mm: mmValues[idx] || 0,
      g: gValues[idx] || 0
    };
  }).filter(item => item.mm > 0 || item.g > 0);
}

/** The filament cost the slicer writes into the G-code footer (`; total filament cost = 1.23`), from the filament's cost per kg. */
export function parseFilamentCost(gcodeBytes: Uint8Array | undefined): number {
  if (!gcodeBytes || gcodeBytes.length === 0) return 0;
  const tail = new TextDecoder('utf-8', { fatal: false }).decode(gcodeBytes.subarray(Math.max(0, gcodeBytes.length - 65536)));
  return parseFloat(tail.match(/;\s*total filament cost\s*=\s*([0-9.]+)/)?.[1] ?? '') || 0;
}

/** Millimetres up to 999, metres beyond, each with at most 2 decimals. */
export function formatFilamentLength(mm: number): string {
  return mm > 999 ? `${Number((mm / 1000).toFixed(2))} m` : `${Number(mm.toFixed(2))} mm`;
}

export const SliceStatsPanel: React.FC = () => {
    const { t } = useTranslation();
  const stats = usePreviewStore((s) => s.stats);
  const showStatsPanel = usePreviewStore((s) => s.showStatsPanel);
  const toggleStatsPanel = usePreviewStore((s) => s.toggleStatsPanelAction);
  const openSendDialog = usePrinterConnectionStore((s) => s.openSendDialog);

  const gcodeUrl = useAppStore((s) => s.gcodeUrl);
  const modelFile = useAppStore((s) => s.modelFile);
  const sliceResult = useAppStore((s) => s.sliceResult);
  const selectedFilaments = useAppStore((s) => s.selectedFilaments);
  const currentConfig = useAppStore((s) => s.currentConfig);
  const activePlate = usePlatesStore(s => s.activePlateIndex);

  const [isBreakdownOpen, setIsBreakdownOpen] = useState(false);

  const filamentStats = useMemo(() => {
    return parseFilamentStats(sliceResult?.gcode, sliceResult?.provenance?.filaments ?? [], sliceResult?.provenance?.config ?? {});
  }, [sliceResult?.gcode, selectedFilaments, currentConfig]);

  const filamentCost = useMemo(() => parseFilamentCost(sliceResult?.gcode), [sliceResult?.gcode]);

  if (!stats) return null;

  const downloadFileName = modelFile
    ? `${modelFile.name.substring(0, modelFile.name.lastIndexOf('.')) || modelFile.name}.gcode`
    : 'print.gcode';

  const timeFormatted = formatPrintTime(stats.timeS);
  const filamentM = stats.filamentMm > 0 ? formatFilamentLength(stats.filamentMm) : '-';
  const filamentG = stats.filamentG > 0 ? stats.filamentG.toFixed(2) + ' g' : '-';

  return (
    <div
      id="stats-section"
      data-testid="slice-stats-panel"
      data-expanded={showStatsPanel}
      className="slice-stats-panel ds-float slice-stats-panel"
    >
      {/* Header */}
      <div
        className="slice-stats-panel__head"
      >
        <div className="slicestats-panel__row-31">
          <span>{t("Slicing Statistics")}</span>
          <span id="status-text" className="slicestats-panel__span-30">{t("Slicing complete!")}</span>
        </div>
        <button
          type="button"
          onClick={toggleStatsPanel}
          title={showStatsPanel ? t('Minimize') : t('Expand')}
          className="ds-btn slicestats-panel__button-29"
        >
          {showStatsPanel ? '✕' : '▼'}
        </button>
      </div>

      {showStatsPanel && (
        <>
        <div className="slice-stats-panel__body">
          {/* Key Summary Cards Grid */}
          <div
            className="slice-stats-panel__summary"
          >
            <div
              className="ds-stat slicestats-panel__card-24"
            >
              <div className="ds-stat__label slicestats-panel__div-22">{t("Total Layers")}</div>
              <div className="ds-stat__value slicestats-panel__div-26" id="stat-layers">
                {stats.layers}
              </div>
            </div>

            <div
              className="ds-stat slicestats-panel__card-24"
            >
              <div className="ds-stat__label slicestats-panel__div-22">{t("Print Time")}</div>
              <div className="ds-stat__value slicestats-panel__div-25" id="stat-time">
                {timeFormatted}
              </div>
            </div>

            <div
              className="ds-stat slicestats-panel__card-24"
            >
              <div className="ds-stat__label slicestats-panel__div-22">{t("Filament Length")}</div>
              <div className="ds-stat__value slicestats-panel__div-21" id="stat-filament-mm">
                {filamentM}
              </div>
            </div>

            <div
              className="ds-stat slicestats-panel__card-24"
            >
              <div className="ds-stat__label slicestats-panel__div-22">{t("Filament Weight")}</div>
              <div className="ds-stat__value slicestats-panel__div-21" id="stat-filament-g">
                {filamentG}
              </div>
            </div>
          </div>

          {filamentCost > 0 && (
            <div className="slicestats-panel__card-23">
              <div className="ds-stat__label slicestats-panel__div-22">{t("Filament Cost")}</div>
              <div className="ds-stat__value slicestats-panel__div-21" id="stat-filament-cost">{filamentCost.toFixed(2)}</div>
              <p className="filament-cost-basis">{t('From G-code, based on filament cost/kg. Currency not specified.')}</p>
            </div>
          )}

          {/* Multi-filament Breakdown */}
          {filamentStats.length > 0 && (
            <div id="stat-filaments-section" className="slicestats-panel__div-20">
              <div
                className="slicestats-panel__row-19"
              >
                <span>{t("Filaments (")}{filamentStats.length})</span>
              </div>
              <div className="slicestats-panel__row-18">
                {filamentStats.map((item) => (
                  <div
                    key={item.slot}
                    id={`stat-filament-slot-${item.slot}`}
                    data-testid={`stat-filament-slot-${item.slot}`}
                    className="stat-filament-row slicestats-panel__row-17"
                  >
                    <div className="slicestats-panel__row-16">
                      <span
                        className="slicestats-panel__span-15" style={{ backgroundColor: item.color }}
                      />
                      <span className="slicestats-panel__span-14">#{item.slot}</span>
                      <span
                        className="slicestats-panel__span-13"
                        title={item.name}
                      >
                        {item.name}
                      </span>
                    </div>
                    <div className="slicestats-panel__row-12">
                      <span>{formatFilamentLength(item.mm)}</span>
                      <span className="slicestats-panel__span-5">({item.g.toFixed(2)} {t("g)")}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Feature Breakdown Table */}
          {stats.features && stats.features.length > 0 && (
            <div className="slicestats-panel__div-11">
              <button type="button" aria-expanded={isBreakdownOpen}
                onClick={() => setIsBreakdownOpen(!isBreakdownOpen)}
                className="slicestats-panel__row-10"
              >
                <span>{t("Time by Feature")}</span>
                <span>{isBreakdownOpen ? '▼' : '▶'}</span>
              </button>

              {isBreakdownOpen && (
                <div className="slicestats-panel__row-9">
                  {stats.features.map((feat, idx) => (
                    <div
                      key={idx}
                      className="slicestats-panel__row-8"
                    >
                      <span className="slicestats-panel__span-7">{feat.name}</span>
                      <div className="slicestats-panel__row-6">
                        <span className="slicestats-panel__span-5">{formatPrintTime(feat.timeS)}</span>
                        <span className="slicestats-panel__span-4">
                          {feat.percent.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
          {/* Export stays reachable while the statistics body scrolls. */}
          {gcodeUrl && hasPlateOutput(sliceResult, activePlate) && (
            <div className="slicestats-panel__row-3">
              <OutputReview />
              <a
                id="download-link"
                href={gcodeUrl}
                onClick={(event) => { event.preventDefault(); void exportGcode(); }}
                download={downloadFileName}
                className="ds-btn ds-btn--primary slicestats-panel__a-2"
              >
                {t("Export G-code")}</a>
              <button
                className="ds-btn ds-btn--primary slicestats-panel__button-1"
                onClick={() => openSendDialog()}
              >
                {t("Send to Printer")}</button>
            </div>
          )}
          <SendToPrinterDialog 
             getGcode={() => {
               const result = useAppStore.getState().sliceResult;
               const activeIdx = usePlatesStore.getState().activePlateIndex;
               if (!result || result.plateIndex !== activeIdx) return null;
               return result.gcode;
             }}
             defaultFilename={downloadFileName}
          />
        </>
      )}
    </div>
  );
};
