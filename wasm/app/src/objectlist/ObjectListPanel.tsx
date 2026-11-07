import React, { useEffect, useMemo } from 'react';
import { useObjectListStore } from './objectListStore';
import { usePlateStore } from '../plate/plateStore';
import { useAppStore } from '../store/appStore';
import { usePlatesStore } from '../plates/platesStore';
import { ObjectTreeItem } from './ObjectTreeItem';
import { instancesInGroup } from './plateGroups';
import { ObjectSettingsEditor } from './ObjectSettingsEditor';
import { useTranslation } from "../i18n";

export const ObjectListPanel: React.FC = () => {
    const { t } = useTranslation();
  const { objects, selectedObjectId, isLoading, error, refreshTree } = useObjectListStore();
  const hasSelection = objects.some((object) => object.id === selectedObjectId);
  const plateObjects = usePlateStore((state) => state.objects);
  const modelObjects = useAppStore((state) => state.modelObjects);
  const isEngineReady = useAppStore((state) => state.isEngineReady);

  const plates = usePlatesStore((state) => state.plates);
  const activePlateIndex = usePlatesStore((state) => state.activePlateIndex);
  const setActivePlate = usePlatesStore((state) => state.setActivePlate);

  const groups = useMemo(() => {
    const result = [...plates.map((p) => ({ key: String(p.index), plateIndex: p.index as number | null, title: p.name })),
      { key: 'unassigned', plateIndex: null, title: t("Unassigned") }].map((group) => {
      const instances = instancesInGroup(plateObjects, plates, group.plateIndex);
      return { ...group, instances, objects: objects.filter((o) => instances.has(o.id)) };
    });
    return result.filter((g) => g.objects.length > 0 || g.plateIndex === activePlateIndex);
  }, [plates, plateObjects, objects, activePlateIndex, t]);

  useEffect(() => {
    if (isEngineReady) {
      refreshTree();
    }
  }, [isEngineReady, plateObjects, modelObjects, refreshTree]);

  return (
    <aside
      id="object-list-panel"
      data-testid="object-list-panel"
      className="orca-object-list-panel"
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--canvas-bg)',
        borderRight: '1px solid var(--panel-bg)',
        flexShrink: 0,
        overflow: 'hidden',
        zIndex: 5
      }}
    >
      {/* Panel Title Bar */}
      <div
        style={{
          padding: '10px 14px',
          background: '#202023',
          borderBottom: '1px solid var(--panel-bg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-color)' }}>
            {t("Objects")}</span>
          <span
            id="objects-count-badge"
            data-testid="objects-count-badge"
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              color: 'var(--text-muted)',
              fontSize: '0.7rem',
              padding: '1px 6px',
              borderRadius: 10
            }}
          >
            {objects.length}
          </span>
        </div>

        {isLoading && (
          <span style={{ fontSize: '0.75rem', color: '#009688' }}>
            {t("Updating...")}</span>
        )}
      </div>

      {/* Error Notice */}
      {error && (
        <div
          style={{
            padding: '6px 12px',
            background: 'rgba(239, 68, 68, 0.15)',
            color: '#f87171',
            fontSize: '0.75rem',
            borderBottom: '1px solid rgba(239, 68, 68, 0.3)'
          }}
        >
          {error}
        </div>
      )}

      {/* Grow with the rows until the tree needs its own scrollbar. */}
      <div
        id="object-tree-container"
        data-testid="object-tree-container"
        style={{
          flex: '0 0 auto',
          minHeight: 0,
          maxHeight: 260,
          overflowY: 'auto',
          padding: '8px 10px',
          borderBottom: '1px solid var(--panel-bg)'
        }}
      >
        {objects.length === 0 ? (
          <div
            id="empty-objects-message"
            data-testid="empty-objects-message"
            style={{
              padding: '24px 12px',
              textAlign: 'center',
              color: 'var(--text-dim)',
              fontSize: '0.8rem'
            }}
          >
            {t("No objects loaded.")}<br />
            {t("Import a 3D model to begin.")}</div>
        ) : (
          groups.map((group) => (
            <div key={group.key} className="object-plate-group" data-testid={`plate-group-${group.key}`}>
              <div
                role="button"
                tabIndex={0}
                data-testid={`plate-group-header-${group.key}`}
                aria-pressed={group.plateIndex === activePlateIndex}
                onClick={() => group.plateIndex !== null && setActivePlate(group.plateIndex)}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && group.plateIndex !== null) {
                    e.preventDefault();
                    setActivePlate(group.plateIndex);
                  }
                }}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '4px 8px',
                  margin: '4px 0 2px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  borderRadius: 4,
                  cursor: group.plateIndex === null ? 'default' : 'pointer',
                  color: group.plateIndex === activePlateIndex ? '#009688' : 'var(--text-muted)',
                  background: group.plateIndex === activePlateIndex ? 'rgba(0, 150, 136, 0.12)' : 'rgba(255, 255, 255, 0.04)'
                }}
              >
                <span>{group.title}</span>
                <span data-testid={`plate-group-count-${group.key}`}>{group.objects.length}</span>
              </div>
              {group.objects.map((obj) => <ObjectTreeItem key={`${group.key}:${obj.id}`} object={obj} groupKey={group.key} primaryGroup={groups.find((g) => g.instances.has(obj.id)) === group} plateIndex={group.plateIndex} instanceIds={group.instances.get(obj.id)!} groupIds={group.objects.map((o) => o.id)} />)}
            </div>
          ))
        )}
      </div>

      {/* The sidebar or mobile sheet scrolls the full selected editor. */}
      {hasSelection && <div>
        <ObjectSettingsEditor />
      </div>}
    </aside>
  );
};

export default ObjectListPanel;
