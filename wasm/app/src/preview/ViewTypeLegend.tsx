/** Live desktop color scheme, toolpath legend and visibility controls. */
import React, { useState } from 'react';
import { usePreviewStore } from './previewStore';
import { useAppStore } from '../store/appStore';
import type { PreviewViewType } from './types';
import { useTranslation } from '../i18n';
import { Icon } from '../shell/Icon';
import './ViewTypeLegend.css';

function normalizeHexColor(c: string): string {
  const hex = c.trim();
  if (!hex) return 'var(--accent)';
  return (hex.startsWith('#') ? hex : `#${hex}`).slice(0, 7);
}

export const ViewTypeLegend: React.FC = () => {
  const { t } = useTranslation();
  const viewType = usePreviewStore(s => s.viewType);
  const legend = usePreviewStore(s => s.legend);
  const setViewType = usePreviewStore(s => s.setViewTypeAction);
  const toggleExtrusionRole = usePreviewStore(s => s.toggleExtrusionRoleAction);
  const toggleOption = usePreviewStore(s => s.toggleOptionAction);
  const selectedFilaments = useAppStore(s => s.selectedFilaments);
  const currentConfig = useAppStore(s => s.currentConfig);
  const [isFolded, setIsFolded] = useState(false);
  const parsedColors = (currentConfig.filament_colour || '').split(';').map(c => c.trim()).filter(Boolean).map(normalizeHexColor);
  let displayItems = legend.items || [];
  if (viewType === 'Tool' || viewType === 'ColorPrint' || viewType === 'Summary') {
    displayItems = displayItems.length ? displayItems.map(item => ({
      ...item,
      name: selectedFilaments[item.id] ? `${t('Filament')} ${item.id + 1} (${selectedFilaments[item.id]})` : item.name,
      color: viewType === 'Tool' ? item.color : parsedColors[item.id] || item.color
    })) : selectedFilaments.map((name, id) => ({ id, name: `${t('Filament')} ${id + 1} (${name})`, color: parsedColors[id] || 'var(--accent)', visible: true }));
  }
  const schemes: Array<[PreviewViewType, string]> = [
    ['FeatureType', 'Line type'], ['Speed', 'Speed'], ['ActualSpeed', 'Actual speed'],
    ['Acceleration', 'Acceleration'], ['Jerk', 'Jerk'], ['Height', 'Layer height'], ['Width', 'Line width'],
    ['VolumetricFlowRate', 'Flow rate'], ['ActualVolumetricFlowRate', 'Actual flow rate'],
    ['LayerTimeLinear', 'Layer time'], ['LayerTimeLogarithmic', 'Layer time (log)'],
    ['FanSpeed', 'Fan speed'], ['Temperature', 'Temperature'], ['PressureAdvance', 'Pressure advance'],
    ['Tool', 'Filament'], ['ColorPrint', 'Color print'], ['Summary', 'Summary']
  ];
  return (
    <div id="preview-legend-panel" data-testid="preview-legend" className="preview-legend ds-float" data-folded={isFolded}>
      <div className="preview-legend__head">
        <button type="button" id="btn-fold-legend" className="preview-legend__fold" onClick={() => setIsFolded(!isFolded)}
          aria-expanded={!isFolded} aria-controls="legend-content-body" aria-label={isFolded ? t('Expand legend') : t('Collapse legend')}
          title={isFolded ? t('Expand legend') : t('Collapse legend')}>{isFolded ? '▶' : '▼'}</button>
        <label htmlFor="view-type-select">{t('Color Scheme:')}</label>
        <select id="view-type-select" data-testid="view-type-select" value={viewType} onChange={e => setViewType(e.target.value as PreviewViewType)}>
          {schemes.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
        </select>
      </div>
      {!isFolded && <div id="legend-content-body" className="preview-legend__body">
        <div id="legend-title" className="preview-legend__title">{viewType === 'Tool' ? t('Filament') : legend.title}</div>
        {displayItems.length > 0 && <div className="preview-legend__list">
          {displayItems.map(item => <div key={item.id} className="legend-row" data-visible={item.visible} data-interactive={legend.type === 'features'}
            onClick={legend.type === 'features' ? () => toggleExtrusionRole(item.id) : undefined}>
            <span className="preview-legend__swatch" style={{ backgroundColor: item.color }} />
            <span className="preview-legend__name" title={item.name}>{item.name}</span>
            {legend.type === 'features' && <button type="button" className="legend-eye-btn" data-testid={`toggle-role-${item.id}`}
              aria-label={`${t('Show')} ${item.name}`} aria-pressed={item.visible}>
              <Icon name={item.visible ? 'heroicons-eye' : 'heroicons-eye-slash'} size={16} />
            </button>}
          </div>)}
        </div>}
        {viewType !== 'Tool' && viewType !== 'ColorPrint' && viewType !== 'Summary' && (legend.ranges || legend.type === 'range') &&
          <div id="legend-ranges-list" className="preview-legend__list">
            {legend.ranges?.length ? legend.ranges.map((range, idx) => <div key={idx} className="preview-legend__range">
              <span className="preview-legend__swatch" style={{ backgroundColor: range.color }} />
              <span>{typeof range.value === 'number' ? range.value.toFixed(viewType === 'PressureAdvance' ? 3 : 1) : range.value}</span>
            </div>) : <div>{t('Calculating range...')}</div>}
          </div>}
        {legend.options && legend.options.length > 0 && <div className="preview-legend__options">
          <div className="preview-legend__title">{t('Features:')}</div>
          {legend.options.map(opt => <div key={opt.id} className="legend-row option-row" data-visible={opt.visible} onClick={() => toggleOption(opt.id)}>
            <span className="preview-legend__swatch" style={{ backgroundColor: opt.color }} />
            <span className="preview-legend__name">{opt.name}</span>
            <button type="button" className="legend-eye-btn" data-testid={`toggle-opt-${opt.id}`} aria-label={`${t('Show')} ${opt.name}`} aria-pressed={opt.visible}>
              <Icon name={opt.visible ? 'heroicons-eye' : 'heroicons-eye-slash'} size={16} />
            </button>
          </div>)}
        </div>}
      </div>}
    </div>
  );
};
