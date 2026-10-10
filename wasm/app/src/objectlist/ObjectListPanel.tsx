import React, { useEffect } from 'react';
import { useObjectListStore } from './objectListStore';
import { usePlateStore } from '../plate/plateStore';
import { useAppStore } from '../store/appStore';
import { ObjectTreeItem } from './ObjectTreeItem';
import { ObjectSettingsEditor } from './ObjectSettingsEditor';
import { useTranslation } from "../i18n";

export const ObjectListPanel: React.FC = () => {
    const { t } = useTranslation();
  const { objects, isLoading, error, refreshTree } = useObjectListStore();
  const plateObjects = usePlateStore((state) => state.objects);
  const modelObjects = useAppStore((state) => state.modelObjects);
  const isEngineReady = useAppStore((state) => state.isEngineReady);

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
        height: '100%',
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

      {/* Tree Section (Top half) */}
      <div
        id="object-tree-container"
        data-testid="object-tree-container"
        style={{
          flex: '0 0 45%',
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
          objects.map((obj) => <ObjectTreeItem key={obj.id} object={obj} />)
        )}
      </div>

      {/* Settings Editor Section (Bottom half) */}
      <div style={{ flex: '1 1 55%', overflow: 'hidden' }}>
        <ObjectSettingsEditor />
      </div>
    </aside>
  );
};

export default ObjectListPanel;
