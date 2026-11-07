import React from 'react';
import { useTranslation } from '../i18n';
import type { DeviceExtruderReading } from './deviceExtruders';

/** Printer-reported physical tools. Assignment and physical presence stay distinct. */
export function ExtruderCards({ extruders, inventoryKnown }: { extruders: DeviceExtruderReading[]; inventoryKnown: boolean }) {
  const { t } = useTranslation();
  const temperature = (value: number | undefined, digits: number) =>
    value != null && Number.isFinite(value) ? `${value.toFixed(digits)} ${t('°C')}` : t('Unavailable');
  return (
    <section className="device-extruders" id="device-extruders" aria-labelledby="device-extruders-title">
      <h4 id="device-extruders-title">{t('Extruders')}</h4>
      {extruders.length === 0 ? <p className="device-message">{inventoryKnown ? t('No filament assignments reported') : t('Filament information unavailable')}</p> : (
        <div className="device-extruder-grid">
          {extruders.map(({ id, toolIndex, heater, filament }) => {
            const presence = filament?.presence ?? 'unknown';
            const color = filament?.color && /^#[\da-f]{6}$/i.test(filament.color) ? filament.color : undefined;
            const label = toolIndex != null ? t('Extruder {{number}}', { number: toolIndex + 1 }) : heater?.label || t('Extruder');
            return (
              <article className="device-extruder-card" key={id} data-tool={toolIndex} data-presence={presence} aria-label={label}>
                <h5>{label}</h5>
                <svg className="device-extruder-icon" viewBox="0 0 56 88" aria-hidden="true" focusable="false"
                  style={color ? { '--filament-color': color } as React.CSSProperties : undefined}>
                  {presence !== 'empty' && <>
                    <path className="device-extruder-feed-border" d="M10 5h10q8 0 8 8v12" />
                    <path className="device-extruder-feed" d="M10 5h10q8 0 8 8v12" />
                  </>}
                  <g className="device-extruder-body">
                    <path d="M22 26v-6h12v6M23 62v6h10v-6" />
                    <rect x="11" y="26" width="34" height="36" rx="4" />
                    <path d="M16 35h24M16 43h24M16 51h24" />
                    <rect x="17" y="68" width="22" height="9" rx="2" />
                    <path d="m22 77 6 7 6-7" />
                  </g>
                </svg>
                <div className="device-extruder-material">
                  <div className="device-extruder-type">{presence === 'empty' ? t('Empty') : filament ? filament.material || t('Unknown material') : t('Filament information unavailable')}</div>
                  {filament && presence !== 'empty' && <>
                    {(filament.vendor || filament.subtype) && <div className="device-filament-detail">{[filament.vendor, filament.subtype].filter(Boolean).join(' · ')}</div>}
                    <div className="device-filament-detail">{presence === 'present' ? t('Present') : t('Presence unknown')}</div>
                    {color && <div className="device-filament-color">
                      <span className="device-filament-swatch" aria-hidden="true" style={{ '--swatch': color } as React.CSSProperties} />
                      <span aria-label={`${t('Color')}: ${color}`}>{color}</span>
                    </div>}
                  </>}
                </div>
                <dl className="device-extruder-temperatures">
                  <div><dt>{t('Current temperature')}</dt><dd>{temperature(heater?.current, 1)}</dd></div>
                  <div><dt>{t('Target temperature')}</dt><dd>{temperature(heater?.target, 0)}</dd></div>
                </dl>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
