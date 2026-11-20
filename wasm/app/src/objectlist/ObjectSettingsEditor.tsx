import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../store/appStore';
import { useObjectListStore } from './objectListStore';
import { ObjectSettingRow } from './ObjectSettingRow';
import type { ObjectTreeNode, VolumeTreeNode } from './types';
import { useTranslation } from "../i18n";
import './ObjectSettingsEditor.css';

const OBJECT_CATEGORIES: Record<string, string[]> = {
  Quality: [
    'extruder',
    'layer_height',
    'seam_position',
    'slice_closing_radius',
    'resolution',
    'xy_hole_compensation',
    'xy_contour_compensation',
    'elefant_foot_compensation',
    'make_overhang_printable_angle',
    'wall_sequence',
    'precise_z_height'
  ],
  Support: [
    'brim_type',
    'brim_width',
    'enable_support',
    'support_type',
    'support_threshold_angle',
    'support_on_build_plate_only',
    'support_filament',
    'support_interface_filament',
    'support_expansion',
    'support_style',
    'tree_support_branch_angle',
    'tree_support_wall_count',
    'support_top_z_distance',
    'support_bottom_z_distance',
    'support_base_pattern'
  ],
  Speed: ['support_speed', 'support_interface_speed']
};

const LAYER_RANGE_CATEGORIES: Record<string, string[]> = {
  Quality: [
    'layer_height',
    'ironing_type',
    'ironing_flow',
    'ironing_spacing',
    'ironing_inset',
    'bridge_flow',
    'make_overhang_printable'
  ],
  Strength: [
    'wall_loops',
    'top_shell_layers',
    'top_shell_thickness',
    'bottom_shell_layers',
    'bottom_shell_thickness',
    'sparse_infill_density',
    'sparse_infill_pattern',
    'top_surface_pattern',
    'bottom_surface_pattern',
    'internal_solid_infill_pattern',
    'infill_combination',
    'infill_wall_overlap'
  ],
  Speed: [
    'outer_wall_speed',
    'inner_wall_speed',
    'sparse_infill_speed',
    'top_surface_speed',
    'internal_solid_infill_speed',
    'bridge_speed',
    'gap_infill_speed'
  ],
  Extruder: ['extruder']
};

const PART_CATEGORIES: Record<string, string[]> = {
  Quality: [
    'extruder',
    'ironing_type',
    'ironing_flow',
    'ironing_spacing',
    'ironing_inset',
    'bridge_flow',
    'make_overhang_printable'
  ],
  Strength: [
    'wall_loops',
    'top_shell_layers',
    'top_shell_thickness',
    'bottom_shell_layers',
    'bottom_shell_thickness',
    'sparse_infill_density',
    'sparse_infill_pattern',
    'top_surface_pattern',
    'bottom_surface_pattern',
    'internal_solid_infill_pattern',
    'infill_combination',
    'infill_wall_overlap'
  ],
  Speed: [
    'outer_wall_speed',
    'inner_wall_speed',
    'sparse_infill_speed',
    'top_surface_speed',
    'internal_solid_infill_speed',
    'bridge_speed',
    'gap_infill_speed'
  ]
};

export const ObjectSettingsEditor: React.FC = () => {
  const { t } = useTranslation();
  const {
    objects,
    selectedObjectId,
    selectedVolumeId,
    selectedRangeIndex,
    setObjectConfig,
    resetObjectConfig,
    setLayerRangeConfig,
    resetLayerRangeConfig,
    editLayerRange,
    deleteLayerRange
  } = useObjectListStore();
  const { configDefs, currentConfig } = useAppStore();

  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0, maxHeight: 300 });
  const [localMinZ, setLocalMinZ] = useState<string>('');
  const [localMaxZ, setLocalMaxZ] = useState<string>('');
  const [rangeError, setRangeError] = useState<string | null>(null);

  const selectedObject: ObjectTreeNode | undefined = selectedObjectId !== null ? objects.find((o) => o.id === selectedObjectId) : undefined;
  const isRange = selectedRangeIndex !== null && selectedRangeIndex !== undefined;
  const selectedRange = isRange && selectedObject ? selectedObject.layerRanges?.[selectedRangeIndex] : undefined;

  const selectedVolume: VolumeTreeNode | undefined =
    !isRange && selectedObject && selectedVolumeId !== null ? selectedObject.volumes.find((v) => v.id === selectedVolumeId) : undefined;

  const isVolume = !isRange && selectedVolume !== undefined;

  React.useEffect(() => {
    if (selectedRange) {
      setLocalMinZ(selectedRange.minZ.toFixed(2));
      setLocalMaxZ(selectedRange.maxZ.toFixed(2));
      setRangeError(null);
    }
  }, [selectedRange?.minZ, selectedRange?.maxZ, selectedRangeIndex]);

  if (selectedObjectId === null) {
    return (
      <div className="object-settings-placeholder">
        {t("Select an object or part to edit overrides")}
      </div>
    );
  }

  if (!selectedObject) return null;

  const targetName = isRange && selectedRange
    ? `${t("Height range")} [${selectedRange.minZ.toFixed(2)} - ${selectedRange.maxZ.toFixed(2)} mm]`
    : isVolume
    ? `${selectedVolume.name} (${selectedVolume.type})`
    : selectedObject.name;

  const currentOverrides: Record<string, string> = isRange && selectedRange
    ? { layer_height: currentConfig['layer_height'] || '0.2', ...(selectedRange.config || {}) }
    : isVolume
    ? selectedVolume.config || {}
    : selectedObject.config || {};
  const overrideKeys = Object.keys(currentOverrides);

  // Available option categories for this target
  const availableCategories: Record<string, string[]> = {};
  if (isRange) {
    Object.assign(availableCategories, LAYER_RANGE_CATEGORIES);
  } else if (isVolume) {
    Object.assign(availableCategories, PART_CATEGORIES);
  } else {
    // For object, merge both
    for (const [cat, keys] of Object.entries(OBJECT_CATEGORIES)) {
      availableCategories[cat] = [...keys];
    }
    for (const [cat, keys] of Object.entries(PART_CATEGORIES)) {
      if (!availableCategories[cat]) availableCategories[cat] = [];
      for (const k of keys) {
        if (!availableCategories[cat].includes(k)) {
          availableCategories[cat].push(k);
        }
      }
    }
  }

  const handleCommitBounds = async () => {
    if (!isRange || selectedRangeIndex === null) return;
    const min = parseFloat(localMinZ);
    const max = parseFloat(localMaxZ);
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      setRangeError(t("Heights must be valid numbers"));
      return;
    }
    try {
      setRangeError(null);
      await editLayerRange(selectedObjectId, selectedRangeIndex, min, max);
    } catch (err: any) {
      setRangeError(err.message || t("Invalid range bounds"));
    }
  };

  const handleAddOption = async (key: string) => {
    setIsAddMenuOpen(false);
    const def = configDefs[key];
    const initialVal = currentConfig[key] || def?.default || '0';
    if (isRange && selectedRangeIndex !== null) {
      await setLayerRangeConfig(selectedObjectId, selectedRangeIndex, { [key]: initialVal });
    } else {
      await setObjectConfig(selectedObjectId, isVolume ? selectedVolume.id : null, { [key]: initialVal });
    }
  };

  const handleChangeOption = async (key: string, value: string) => {
    if (isRange && selectedRangeIndex !== null) {
      await setLayerRangeConfig(selectedObjectId, selectedRangeIndex, { [key]: value });
    } else {
      await setObjectConfig(selectedObjectId, isVolume ? selectedVolume.id : null, { [key]: value });
    }
  };

  const handleRemoveOption = async (key: string) => {
    if (isRange && selectedRangeIndex !== null) {
      await resetLayerRangeConfig(selectedObjectId, selectedRangeIndex, [key]);
    } else {
      await resetObjectConfig(selectedObjectId, isVolume ? selectedVolume.id : null, [key]);
    }
  };

  const handleResetAll = async () => {
    if (isRange && selectedRangeIndex !== null) {
      await resetLayerRangeConfig(selectedObjectId, selectedRangeIndex);
    } else {
      await resetObjectConfig(selectedObjectId, isVolume ? selectedVolume.id : null);
    }
  };

  return (
    <div
      id="object-settings-editor"
      data-testid="object-settings-editor"
      className="object-settings-editor"
    >
      {/* Header */}
      <div className="object-overrides-header">
        <div className="object-overrides-heading">
          <div className="object-overrides-eyebrow">
            {isRange ? t('Layer Range Overrides') : isVolume ? t('Part Overrides') : t('Object Overrides')}
          </div>
          <div
            className="object-overrides-target"
            title={targetName}
          >
            {targetName}
          </div>
        </div>

        <div className="object-overrides-actions">
          <button
            type="button"
            id="btn-add-setting"
            data-testid="btn-add-setting"
            onClick={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              const below = window.innerHeight - box.bottom - 8;
              const height = Math.min(300, Math.max(below, box.top - 8));
              setMenuPosition({ left: Math.max(8, box.right - 240), top: below >= height ? box.bottom + 4 : box.top - height - 4, maxHeight: height });
              setIsAddMenuOpen(!isAddMenuOpen);
            }}
            className="object-editor-btn object-editor-btn--primary"
          >
            {t("+ Add Setting")}
          </button>

          {overrideKeys.length > 0 && (
            <button
              type="button"
              id="btn-reset-overrides"
              data-testid="btn-reset-overrides"
              onClick={handleResetAll}
              title={t("Reset all overrides")}
              className="object-editor-btn object-editor-btn--danger"
            >
              {t("Reset All")}
            </button>
          )}

          {/* Add Setting Popup */}
          {isAddMenuOpen && createPortal((
            <div
              id="add-setting-dropdown"
              data-testid="add-setting-dropdown"
              className="object-add-dropdown"
              style={menuPosition}
            >
              <div className="object-add-filter-wrap">
                <input
                  type="text"
                  placeholder={t("Filter settings...")}
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  className="object-add-filter-input"
                  autoFocus
                />
              </div>

              <div className="object-add-options-scroll">
                {Object.entries(availableCategories).map(([cat, keys]) => {
                  const filteredKeys = keys.filter((k) => {
                    if (currentOverrides[k] !== undefined) return false;
                    if (!searchFilter) return true;
                    const def = configDefs[k];
                    const label = def?.label || k;
                    return label.toLowerCase().includes(searchFilter.toLowerCase()) || k.toLowerCase().includes(searchFilter.toLowerCase());
                  });

                  if (filteredKeys.length === 0) return null;

                  return (
                    <div key={cat} className="object-add-category-group">
                      <div className="object-add-category">
                        {cat}
                      </div>
                      {filteredKeys.map((k) => {
                        const def = configDefs[k];
                        const label = def?.label || k;
                        return (
                          <button
                            type="button"
                            key={k}
                            id={`add-setting-opt-${k}`}
                            data-testid={`add-setting-opt-${k}`}
                            onClick={() => handleAddOption(k)}
                            className="object-add-option"
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          ), document.body)}
        </div>
      </div>

      {/* Layer range bounds editor */}
      {isRange && selectedRange && (
        <div
          id="layer-range-bounds-bar"
          data-testid="layer-range-bounds-bar"
          className="object-range-bounds-bar"
        >
          <span className="object-range-prefix">{t("Range:")}</span>
          <label className="object-range-field">
            <span className="object-range-z-label">Min Z:</span>
            <input
              id="range-min-z-input"
              data-testid="range-min-z-input"
              type="number"
              step="0.1"
              min="0"
              value={localMinZ}
              onChange={(e) => setLocalMinZ(e.target.value)}
              onBlur={handleCommitBounds}
              onKeyDown={(e) => e.key === 'Enter' && handleCommitBounds()}
              className="object-range-z-input"
            />
          </label>
          <span className="object-range-sep">-</span>
          <label className="object-range-field">
            <span className="object-range-z-label">Max Z:</span>
            <input
              id="range-max-z-input"
              data-testid="range-max-z-input"
              type="number"
              step="0.1"
              min="0"
              value={localMaxZ}
              onChange={(e) => setLocalMaxZ(e.target.value)}
              onBlur={handleCommitBounds}
              onKeyDown={(e) => e.key === 'Enter' && handleCommitBounds()}
              className="object-range-z-input"
            />
          </label>
          <span className="object-range-unit">mm</span>
          <div className="object-range-spacer" />
          <button
            type="button"
            id="btn-delete-layer-range"
            data-testid="btn-delete-layer-range"
            onClick={() => void deleteLayerRange(selectedObjectId, selectedRangeIndex)}
            className="object-range-delete-btn"
          >
            {t("Delete Range")}
          </button>
        </div>
      )}
      {rangeError && (
        <div
          id="layer-range-error-banner"
          data-testid="layer-range-error-banner"
          className="object-range-error-banner"
        >
          {rangeError}
        </div>
      )}

      {/* List of active overrides */}
      <div className="object-overrides-list">
        {overrideKeys.length === 0 ? (
          <div className="object-overrides-empty">
            {t("No custom overrides set.")}<br />
            {t("Click")} <strong>{t("+ Add Setting")}</strong> {t("to customize parameters for this")} {isVolume ? t('part') : t('object')}.
          </div>
        ) : (
          overrideKeys.map((key) => (
            <ObjectSettingRow
              key={key}
              optionKey={key}
              value={currentOverrides[key]}
              onChange={(newVal) => handleChangeOption(key, newVal)}
              onRemove={() => handleRemoveOption(key)}
            />
          ))
        )}
      </div>
    </div>
  );
};
