import React, { useEffect, useMemo } from 'react';
import { useObjectListStore } from './objectListStore';
import { usePlateStore } from '../plate/plateStore';
import { useAppStore } from '../store/appStore';
import { usePlatesStore } from '../plates/platesStore';
import { ObjectTreeItem } from './ObjectTreeItem';
import { instancesInGroup } from './plateGroups';
import { ObjectSettingsEditor } from './ObjectSettingsEditor';
import { useTranslation } from "../i18n";
import './ObjectSettingsEditor.css';

export interface ObjectListPanelProps {
  hideHeader?: boolean;
}

export const ObjectListPanel: React.FC<ObjectListPanelProps> = ({ hideHeader = false }) => {
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
    >
      {/* Panel Title Bar (hidden when embedded in an already-titled section/sheet) */}
      {!hideHeader ? (
        <div className="object-list-header">
          <div className="object-list-header-title-wrap">
            <span className="object-list-header-title">
              {t("Objects")}
            </span>
            <span
              id="objects-count-badge"
              data-testid="objects-count-badge"
              className="object-list-count-badge"
            >
              {objects.length}
            </span>
          </div>

          {isLoading && (
            <span className="object-list-loading">
              {t("Updating...")}
            </span>
          )}
        </div>
      ) : isLoading ? (
        <div className="object-list-status-row">
          <span className="object-list-loading">
            {t("Updating...")}
          </span>
        </div>
      ) : null}

      {/* Error Notice */}
      {error && (
        <div className="object-list-error">
          {error}
        </div>
      )}

      {/* Grow with the rows until the tree needs its own scrollbar. */}
      <div
        id="object-tree-container"
        data-testid="object-tree-container"
        className="object-tree-container"
      >
        {objects.length === 0 ? (
          <div
            id="empty-objects-message"
            data-testid="empty-objects-message"
            className="object-list-empty"
          >
            {t("No objects loaded.")}<br />
            {t("Import a 3D model to begin.")}
          </div>
        ) : (
          groups.map((group) => {
            const isActivePlate = group.plateIndex === activePlateIndex;
            const isUnassigned = group.plateIndex === null;
            return (
              <div key={group.key} className="object-plate-group" data-testid={`plate-group-${group.key}`}>
                <div
                  role="button"
                  tabIndex={0}
                  data-testid={`plate-group-header-${group.key}`}
                  aria-pressed={isActivePlate}
                  onClick={() => !isUnassigned && setActivePlate(group.plateIndex!)}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && !isUnassigned) {
                      e.preventDefault();
                      setActivePlate(group.plateIndex!);
                    }
                  }}
                  className={`object-plate-group-header${isActivePlate ? ' is-active' : ''}${isUnassigned ? ' is-unassigned' : ''}`}
                >
                  <span className="object-plate-group-title">{group.title}</span>
                  <span className="object-plate-group-count" data-testid={`plate-group-count-${group.key}`}>
                    {group.objects.length}
                  </span>
                </div>
                {group.objects.map((obj) => (
                  <ObjectTreeItem
                    key={`${group.key}:${obj.id}`}
                    object={obj}
                    groupKey={group.key}
                    primaryGroup={groups.find((g) => g.instances.has(obj.id)) === group}
                    plateIndex={group.plateIndex}
                    instanceIds={group.instances.get(obj.id)!}
                    groupIds={group.objects.map((o) => o.id)}
                  />
                ))}
              </div>
            );
          })
        )}
      </div>

      {/* The sidebar or mobile sheet scrolls the full selected editor. */}
      {hasSelection && (
        <div className="object-list-editor-wrap">
          <ObjectSettingsEditor />
        </div>
      )}
    </aside>
  );
};

export default ObjectListPanel;
