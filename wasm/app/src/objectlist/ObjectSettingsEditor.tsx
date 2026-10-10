import React, { useState } from 'react';
import { useAppStore } from '../store/appStore';
import { useObjectListStore } from './objectListStore';
import { ObjectSettingRow } from './ObjectSettingRow';
import type { ObjectTreeNode, VolumeTreeNode } from './types';

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
  const { objects, selectedObjectId, selectedVolumeId, setObjectConfig, resetObjectConfig } = useObjectListStore();
  const { configDefs, currentConfig } = useAppStore();

  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');

  if (selectedObjectId === null) {
    return (
      <div style={{ padding: 16, color: '#71717a', fontSize: '0.85rem', textAlign: 'center' }}>
        Select an object or part to edit overrides
      </div>
    );
  }

  const selectedObject: ObjectTreeNode | undefined = objects.find((o) => o.id === selectedObjectId);
  if (!selectedObject) return null;

  const selectedVolume: VolumeTreeNode | undefined =
    selectedVolumeId !== null ? selectedObject.volumes.find((v) => v.id === selectedVolumeId) : undefined;

  const isVolume = selectedVolume !== undefined;
  const targetName = isVolume ? `${selectedVolume.name} (${selectedVolume.type})` : selectedObject.name;
  const currentOverrides: Record<string, string> = isVolume ? selectedVolume.config || {} : selectedObject.config || {};
  const overrideKeys = Object.keys(currentOverrides);

  // Available option categories for this target
  const availableCategories: Record<string, string[]> = {};
  if (isVolume) {
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

  const handleAddOption = async (key: string) => {
    setIsAddMenuOpen(false);
    const def = configDefs[key];
    const initialVal = currentConfig[key] || def?.default || '0';
    await setObjectConfig(selectedObjectId, isVolume ? selectedVolume.id : null, { [key]: initialVal });
  };

  const handleChangeOption = async (key: string, value: string) => {
    await setObjectConfig(selectedObjectId, isVolume ? selectedVolume.id : null, { [key]: value });
  };

  const handleRemoveOption = async (key: string) => {
    await resetObjectConfig(selectedObjectId, isVolume ? selectedVolume.id : null, [key]);
  };

  const handleResetAll = async () => {
    await resetObjectConfig(selectedObjectId, isVolume ? selectedVolume.id : null);
  };

  return (
    <div
      id="object-settings-editor"
      data-testid="object-settings-editor"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        background: '#18181b',
        borderTop: '1px solid #27272a'
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '8px 12px',
          background: '#202023',
          borderBottom: '1px solid #27272a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <div style={{ overflow: 'hidden' }}>
          <div style={{ fontSize: '0.7rem', color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {isVolume ? 'Part Overrides' : 'Object Overrides'}
          </div>
          <div
            style={{
              fontSize: '0.85rem',
              fontWeight: 600,
              color: '#f4f4f5',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
            title={targetName}
          >
            {targetName}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
          <button
            type="button"
            id="btn-add-setting"
            data-testid="btn-add-setting"
            onClick={() => setIsAddMenuOpen(!isAddMenuOpen)}
            style={{
              background: '#009688',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              padding: '4px 8px',
              fontSize: '0.78rem',
              fontWeight: 500,
              cursor: 'pointer'
            }}
          >
            + Add Setting
          </button>

          {overrideKeys.length > 0 && (
            <button
              type="button"
              id="btn-reset-overrides"
              data-testid="btn-reset-overrides"
              onClick={handleResetAll}
              title="Reset all overrides"
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                color: '#f87171',
                border: 'none',
                borderRadius: 4,
                padding: '4px 8px',
                fontSize: '0.78rem',
                cursor: 'pointer'
              }}
            >
              Reset All
            </button>
          )}

          {/* Add Setting Popup */}
          {isAddMenuOpen && (
            <div
              id="add-setting-dropdown"
              data-testid="add-setting-dropdown"
              style={{
                position: 'absolute',
                right: 0,
                top: '100%',
                marginTop: 4,
                width: 240,
                maxHeight: 300,
                background: '#27272a',
                border: '1px solid #3f3f46',
                borderRadius: 6,
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
                zIndex: 100,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
              }}
            >
              <div style={{ padding: '6px 8px', borderBottom: '1px solid #3f3f46' }}>
                <input
                  type="text"
                  placeholder="Filter settings..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  style={{
                    width: '100%',
                    background: '#18181b',
                    border: '1px solid #3f3f46',
                    borderRadius: 4,
                    color: '#fff',
                    padding: '3px 6px',
                    fontSize: '0.75rem',
                    outline: 'none'
                  }}
                  autoFocus
                />
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
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
                    <div key={cat} style={{ marginBottom: 4 }}>
                      <div
                        style={{
                          fontSize: '0.7rem',
                          color: '#009688',
                          fontWeight: 600,
                          padding: '3px 10px',
                          textTransform: 'uppercase'
                        }}
                      >
                        {cat}
                      </div>
                      {filteredKeys.map((k) => {
                        const def = configDefs[k];
                        const label = def?.label || k;
                        return (
                          <div
                            key={k}
                            id={`add-setting-opt-${k}`}
                            data-testid={`add-setting-opt-${k}`}
                            onClick={() => handleAddOption(k)}
                            style={{
                              padding: '5px 12px',
                              fontSize: '0.78rem',
                              color: '#e4e4e7',
                              cursor: 'pointer'
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                          >
                            {label}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* List of active overrides */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {overrideKeys.length === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: '#71717a', fontSize: '0.8rem' }}>
            No custom overrides set.
            <br />
            Click <strong>+ Add Setting</strong> to customize parameters for this {isVolume ? 'part' : 'object'}.
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
