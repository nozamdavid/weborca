import React from 'react';
import { CAMERA_VIEWS, setCameraView } from './cameraBridge';
import { Icon } from './Icon';
import { usePrefsStore } from '../prefs';
import { useTranslation } from "../i18n";

export interface CanvasTool {
  id: string;
  testId?: string;
  label: string;
  shortcut?: string;
  /** Name of a desktop icon in public/icons, or a ready-made glyph. */
  icon: string | React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  data?: Record<string, string | boolean>;
  onClick: () => void;
}

/** The vertical tool strip on the left of the 3D canvas, like desktop's: icons only, names in tooltips. */
export const CanvasToolbar: React.FC<{ groups: CanvasTool[][] }> = ({ groups }) => {
    const { t } = useTranslation();
  const orientation = usePrefsStore((s) => s.display.toolbarOrientation);
  return (
  <div className={`canvas-toolbar ${orientation}`} id="plate-toolbar" role="toolbar" aria-orientation={orientation} aria-label={t("Tools")}>
    {groups.map((group, i) => (
      <React.Fragment key={i}>
        {i > 0 && <div className="tool-sep" />}
        {group.map((t) => (
          <button
            key={t.id}
            id={t.id}
            data-testid={t.testId}
            className={`icon-btn ${t.active ? 'active' : ''} ${t.danger ? 'danger' : ''}`}
            aria-label={t.label}
            aria-pressed={t.active}
            data-tip={t.shortcut ? `${t.label} (${t.shortcut})` : t.label}
            disabled={t.disabled}
            onClick={t.onClick}
            {...Object.fromEntries(Object.entries(t.data ?? {}).map(([k, v]) => [`data-${k}`, String(v)]))}
          >
            {typeof t.icon === 'string' ? <Icon name={t.icon} /> : t.icon}
          </button>
        ))}
      </React.Fragment>
    ))}
  </div>
  );
};

/** Camera view buttons in the corner of the canvas (keys 0 to 6). */
export const ViewButtons: React.FC = () => { const { t } = useTranslation(); return (
  <div className="view-buttons" role="group" aria-label={t("Camera views")}>
    {CAMERA_VIEWS.map((v) => (
      <button key={v.label} id={`view-${v.label.toLowerCase()}`} title={`${v.label} view (${v.key})`} onClick={() => setCameraView(v.view)}>{v.label}</button>
    ))}
    <button id="view-fit" title={t("Zoom to selection (Z)")} onClick={() => setCameraView('Z')}>{t("Fit")}</button>
  </div>
  );
};
