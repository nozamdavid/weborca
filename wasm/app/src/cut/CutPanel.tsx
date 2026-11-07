import './CutPanel.css';
/**
 * @file CutPanel.tsx
 * Tool panel for Planar Cutting and Assembly Connectors in OrcaSlicer WASM.
 */

import React, { useEffect } from 'react';
import { getConnectorIssues, useCutStore } from './cutStore';
import type {
  CutConnectorType,
  CutConnectorStyle,
  CutConnectorShape
} from './types';
import { useTranslation } from "../i18n";

export const CutPanel: React.FC = () => {
    const { t } = useTranslation();
  const isCutActive = useCutStore((s) => s.isCutActive);
  const selectedObjectId = useCutStore((s) => s.selectedObjectId);
  const z = useCutStore((s) => s.z);
  const zMin = useCutStore((s) => s.zMin);
  const zMax = useCutStore((s) => s.zMax);
  const keepUpper = useCutStore((s) => s.keepUpper);
  const keepLower = useCutStore((s) => s.keepLower);
  const keepAsParts = useCutStore((s) => s.keepAsParts);
  const placeOnCutUpper = useCutStore((s) => s.placeOnCutUpper);
  const placeOnCutLower = useCutStore((s) => s.placeOnCutLower);
  const flipUpper = useCutStore((s) => s.flipUpper);
  const flipLower = useCutStore((s) => s.flipLower);
  const flipPlane = useCutStore((s) => s.flipPlane);
  const rotX = useCutStore((s) => s.rotX);
  const rotY = useCutStore((s) => s.rotY);
  const rotZ = useCutStore((s) => s.rotZ);
  const connectors = useCutStore((s) => s.connectors);
  const selectedConnectorIndex = useCutStore((s) => s.selectedConnectorIndex);
  const defaultAttrs = useCutStore((s) => s.defaultAttrs);
  const isCutting = useCutStore((s) => s.isCutting);
  const error = useCutStore((s) => s.error);
  const lastResult = useCutStore((s) => s.lastResult);

  const setZ = useCutStore((s) => s.setZ);
  const setKeepUpper = useCutStore((s) => s.setKeepUpper);
  const setKeepLower = useCutStore((s) => s.setKeepLower);
  const setKeepAsParts = useCutStore((s) => s.setKeepAsParts);
  const setPlaceOnCutUpper = useCutStore((s) => s.setPlaceOnCutUpper);
  const setPlaceOnCutLower = useCutStore((s) => s.setPlaceOnCutLower);
  const setFlipUpper = useCutStore((s) => s.setFlipUpper);
  const setFlipLower = useCutStore((s) => s.setFlipLower);
  const toggleFlipPlane = useCutStore((s) => s.toggleFlipPlane);
  const setRotX = useCutStore((s) => s.setRotX);
  const setRotY = useCutStore((s) => s.setRotY);
  const setRotZ = useCutStore((s) => s.setRotZ);
  const resetRotation = useCutStore((s) => s.resetRotation);
  const addConnector = useCutStore((s) => s.addConnector);
  const removeConnector = useCutStore((s) => s.removeConnector);
  const updateDefaultAttrs = useCutStore((s) => s.updateDefaultAttrs);
  const clearConnectors = useCutStore((s) => s.clearConnectors);
  const selectConnector = useCutStore((s) => s.selectConnector);
  const performCut = useCutStore((s) => s.performCut);
  const closeCut = useCutStore((s) => s.closeCut);
  const connectorMode = useCutStore((s) => s.connectorMode);
  const setConnectorMode = useCutStore((s) => s.setConnectorMode);
  const section = useCutStore((s) => s.section);
  const issues = getConnectorIssues({ connectors, section });
  const hasInvalidConnector = issues.some((issue) => issue !== null);

  // While placing connectors, Escape returns to the plane (as desktop does) rather than closing the tool,
  // and Delete removes the selected connector. Capture runs before the window-level shortcut handler.
  useEffect(() => {
    if (!isCutActive || !connectorMode) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      const state = useCutStore.getState();
      if (e.key === 'Escape') state.setConnectorMode(false);
      else if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedConnectorIndex !== null) state.removeConnector(state.selectedConnectorIndex);
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isCutActive, connectorMode]);

  if (!isCutActive) {
    return null;
  }

  const hasConnectors = connectors.length > 0;
  const isSnap = defaultAttrs.type === 'snap';
  const isPlug = defaultAttrs.type === 'plug';
  const isDowel = defaultAttrs.type === 'dowel';
  const isCutFinished = lastResult?.success === true;

  const connectorTypes: CutConnectorType[] = ['plug', 'dowel', 'snap'];
  const connectorStyles: CutConnectorStyle[] = ['prism', 'frustum'];
  const connectorShapes: CutConnectorShape[] = ['circle', 'hexagon', 'square', 'triangle'];

  return (
    <div
      id="cut-tool-panel"
      data-testid="cut-tool-panel"
      className="cut-tool-panel ds-float cut-panel"
    >
      {/* Panel Header */}
      <div
        className="cut-panel__head"
      >
        <div className="cut-panel__label-43">
          <span className="cut-panel__span-60">{t("✂️")}</span>
          <span className="ds-title ds-title--panel cut-panel__title">
            {t("Cut Object")}{selectedObjectId ? `#${selectedObjectId}` : ''}
          </span>
        </div>
        <button
          id="close-cut-btn"
          data-testid="close-cut-btn"
          onClick={closeCut}
          className="ds-btn cut-panel__button-58"
          title={t("Close cut tool")}
        >
          ✕
        </button>
      </div>

      {/* Plane Height Slider */}
      <div className="cut-panel__div-51">
        <div className="cut-panel__row-57">
          <span className="cut-panel__span-56">{t("Cut Height (Z)")}</span>
          <span id="cut-z-display" className="cut-panel__span-55">{z.toFixed(2)} {t("mm")}</span>
        </div>
        <div className="cut-panel__row-54">
          <input
            id="cut-z-slider"
            data-testid="cut-z-slider"
            type="range"
            min={zMin}
            max={zMax}
            step={0.1}
            value={z}
            disabled={isCutFinished}
            onChange={(e) => setZ(parseFloat(e.target.value))}
            className="cut-panel__input-53"
          />
          <input
            id="cut-z-input"
            data-testid="cut-z-input"
            type="number"
            min={zMin}
            max={zMax}
            step={0.1}
            value={z}
            disabled={isCutFinished}
            onChange={(e) => setZ(parseFloat(e.target.value) || 0)}
            className="ds-input cut-panel__input-52"
          />
        </div>
      </div>

      {/* Plane Rotation */}
      <div className="cut-panel__div-51">
        <div className="cut-panel__row-57" style={{ alignItems: 'center' }}>
          <span className="cut-panel__span-56">{t("Rotation (X, Y, Z)")}</span>
          <button
            id="cut-reset-rotation-btn"
            data-testid="cut-reset-rotation-btn"
            type="button"
            className="ds-btn btn-secondary btn-xs"
            disabled={isCutFinished || (rotX === 0 && rotY === 0 && rotZ === 0)}
            onClick={resetRotation}
            title={t("Reset cut plane to horizontal")}
            style={{ fontSize: '0.75rem', padding: '2px 8px' }}
          >
            {t("Reset to horizontal")}
          </button>
        </div>

        {/* X Rotation */}
        <div className="cut-panel__row-57" style={{ marginTop: '8px' }}>
          <span className="cut-panel__span-56">{t("Rotate X")}</span>
          <span id="cut-rot-x-display" className="cut-panel__span-55">{rotX.toFixed(1)}°</span>
        </div>
        <div className="cut-panel__row-54">
          <input
            id="cut-rot-x-slider"
            data-testid="cut-rot-x-slider"
            type="range"
            min={-180}
            max={180}
            step={1}
            value={rotX}
            disabled={isCutFinished}
            onChange={(e) => setRotX(parseFloat(e.target.value) || 0)}
            className="cut-panel__input-53"
          />
          <input
            id="cut-rot-x-input"
            data-testid="cut-rot-x-input"
            type="number"
            min={-180}
            max={180}
            step={1}
            value={rotX}
            disabled={isCutFinished}
            onChange={(e) => setRotX(parseFloat(e.target.value) || 0)}
            className="ds-input cut-panel__input-52"
          />
        </div>

        {/* Y Rotation */}
        <div className="cut-panel__row-57" style={{ marginTop: '8px' }}>
          <span className="cut-panel__span-56">{t("Rotate Y")}</span>
          <span id="cut-rot-y-display" className="cut-panel__span-55">{rotY.toFixed(1)}°</span>
        </div>
        <div className="cut-panel__row-54">
          <input
            id="cut-rot-y-slider"
            data-testid="cut-rot-y-slider"
            type="range"
            min={-180}
            max={180}
            step={1}
            value={rotY}
            disabled={isCutFinished}
            onChange={(e) => setRotY(parseFloat(e.target.value) || 0)}
            className="cut-panel__input-53"
          />
          <input
            id="cut-rot-y-input"
            data-testid="cut-rot-y-input"
            type="number"
            min={-180}
            max={180}
            step={1}
            value={rotY}
            disabled={isCutFinished}
            onChange={(e) => setRotY(parseFloat(e.target.value) || 0)}
            className="ds-input cut-panel__input-52"
          />
        </div>

        {/* Z Rotation */}
        <div className="cut-panel__row-57" style={{ marginTop: '8px' }}>
          <span className="cut-panel__span-56">{t("Rotate Z")}</span>
          <span id="cut-rot-z-display" className="cut-panel__span-55">{rotZ.toFixed(1)}°</span>
        </div>
        <div className="cut-panel__row-54">
          <input
            id="cut-rot-z-slider"
            data-testid="cut-rot-z-slider"
            type="range"
            min={-180}
            max={180}
            step={1}
            value={rotZ}
            disabled={isCutFinished}
            onChange={(e) => setRotZ(parseFloat(e.target.value) || 0)}
            className="cut-panel__input-53"
          />
          <input
            id="cut-rot-z-input"
            data-testid="cut-rot-z-input"
            type="number"
            min={-180}
            max={180}
            step={1}
            value={rotZ}
            disabled={isCutFinished}
            onChange={(e) => setRotZ(parseFloat(e.target.value) || 0)}
            className="ds-input cut-panel__input-52"
          />
        </div>
      </div>

      {/* Plane Orientation & Flip */}
      <div className="cut-panel__div-51">
        <button
          id="cut-flip-plane-btn"
          aria-pressed={flipPlane}
          data-testid="cut-flip-plane-btn"
          onClick={toggleFlipPlane}
          disabled={isCutFinished}
          className={["ds-btn cut-panel__button-50", (flipPlane  ? "cut-panel__state-34" : "cut-panel__state-27"), (flipPlane  ? "cut-panel__state-48" : "cut-panel__state-49"), (flipPlane  ? "cut-panel__state-28" : "cut-panel__state-41"), (isCutFinished  ? "cut-panel__state-4" : "cut-panel__state-5")].join(" ")}
        >
          <span>{t("🔄")}</span>
          <span>{t("Flip Cut Plane Normal")}{flipPlane ? t('(Inverted)') : `(${t('Default')})`}</span>
        </button>
      </div>

      {/* Halves Options */}
      {!connectorMode && <div
        className="cut-panel__section"
      >
        <div className="cut-panel__div-47">
          {t("Halves & Placement")}</div>
        <div className="cut-panel__grid-46">
          <label className={["cut-panel__label-43", (hasConnectors  ? "cut-panel__state-4" : "cut-panel__state-5")].join(" ")}>
            <input
              id="cut-keep-upper"
              data-testid="cut-keep-upper"
              type="checkbox"
              checked={keepUpper}
              disabled={hasConnectors || isCutFinished}
              onChange={(e) => setKeepUpper(e.target.checked)}
              className="cut-panel__input-42"
            />
            <span className={["", (hasConnectors  ? "cut-panel__state-9" : "cut-panel__state-41")].join(" ")}>{t("Keep Upper")}</span>
          </label>
          <label className={["cut-panel__label-43", (hasConnectors  ? "cut-panel__state-4" : "cut-panel__state-5")].join(" ")}>
            <input
              id="cut-keep-lower"
              data-testid="cut-keep-lower"
              type="checkbox"
              checked={keepLower}
              disabled={hasConnectors || isCutFinished}
              onChange={(e) => setKeepLower(e.target.checked)}
              className="cut-panel__input-42"
            />
            <span className={["", (hasConnectors  ? "cut-panel__state-9" : "cut-panel__state-41")].join(" ")}>{t("Keep Lower")}</span>
          </label>

          <label className="cut-panel__label-45">
            <input
              id="cut-place-upper"
              data-testid="cut-place-upper"
              type="checkbox"
              checked={placeOnCutUpper}
              disabled={isCutFinished}
              onChange={(e) => setPlaceOnCutUpper(e.target.checked)}
              className="cut-panel__input-42"
            />
            <span>{t("Place Cut (Up)")}</span>
          </label>
          <label className="cut-panel__label-45">
            <input
              id="cut-place-lower"
              data-testid="cut-place-lower"
              type="checkbox"
              checked={placeOnCutLower}
              disabled={isCutFinished}
              onChange={(e) => setPlaceOnCutLower(e.target.checked)}
              className="cut-panel__input-42"
            />
            <span>{t("Place Cut (Low)")}</span>
          </label>

          <label className="cut-panel__label-45">
            <input
              id="cut-flip-upper"
              data-testid="cut-flip-upper"
              type="checkbox"
              checked={flipUpper}
              disabled={isCutFinished}
              onChange={(e) => setFlipUpper(e.target.checked)}
              className="cut-panel__input-42"
            />
            <span>{t("Flip Upper")}</span>
          </label>
          <label className="cut-panel__label-45">
            <input
              id="cut-flip-lower"
              data-testid="cut-flip-lower"
              type="checkbox"
              checked={flipLower}
              disabled={isCutFinished}
              onChange={(e) => setFlipLower(e.target.checked)}
              className="cut-panel__input-42"
            />
            <span>{t("Flip Lower")}</span>
          </label>
        </div>

        <div className="cut-panel__div-44">
          <label className={["cut-panel__label-43", (hasConnectors  ? "cut-panel__state-4" : "cut-panel__state-5")].join(" ")}>
            <input
              id="cut-keep-as-parts"
              data-testid="cut-keep-as-parts"
              type="checkbox"
              checked={keepAsParts}
              disabled={hasConnectors || isCutFinished}
              onChange={(e) => setKeepAsParts(e.target.checked)}
              className="cut-panel__input-42"
            />
            <span className={["", (hasConnectors  ? "cut-panel__state-9" : "cut-panel__state-41")].join(" ")}>{t("Keep as volumes in one object")}</span>
          </label>
        </div>

        {hasConnectors && (
          <div className="cut-panel__div-40">
            {t("* Connectors require keeping both halves as separate objects.")}</div>
        )}
      </div>}

      {/* Connectors Section */}
      <div
        className="cut-panel__section"
      >
        <div className="cut-panel__div-38">
          <span className="cut-panel__span-37">
            {t("Connectors (")}{connectors.length})
          </span>
          <div className="cut-panel__row-36">
            <button
              id="cut-connectors-mode-btn"
              data-testid="cut-connectors-mode-btn"
              aria-pressed={connectorMode}
              onClick={() => setConnectorMode(!connectorMode)}
              disabled={isCutFinished}
              title={connectorMode ? t("Return to the cut plane") : t("Separate the halves and click the cut faces to place connectors")}
              className={["ds-btn cut-panel__button-35", (connectorMode  ? "cut-panel__state-34" : "cut-panel__state-34"), (isCutFinished  ? "cut-panel__state-4" : "cut-panel__state-5")].join(" ")}
            >
              {connectorMode ? t("Done") : t("Place")}</button>
            <button
              id="cut-add-connector-btn"
              data-testid="cut-add-connector-btn"
              onClick={() => addConnector()}
              disabled={isCutFinished}
              className={["ds-btn cut-panel__button-33", (isCutFinished  ? "cut-panel__state-4" : "cut-panel__state-5")].join(" ")}
            >
              {t("+ Add")}</button>
            {connectors.length > 0 && (
              <button
                id="cut-clear-connectors-btn"
                data-testid="cut-clear-connectors-btn"
                onClick={clearConnectors}
                disabled={isCutFinished}
                className={["ds-btn cut-panel__button-32", (isCutFinished  ? "cut-panel__state-4" : "cut-panel__state-5")].join(" ")}
                title={t("Clear all connectors")}
              >
                {t("Clear")}</button>
            )}
          </div>
        </div>

        {connectorMode && (
          <div id="cut-connector-hint" className="cut-panel__div-31">
            {t("Click a cut face to place a connector, or a connector to select it. Settings below apply to the selected connector. Esc returns to the plane.")}
          </div>
        )}

        {/* Default / Active Connector Settings */}
        <div
          className="cut-panel__grid-30"
        >
          <div>
            <label className="cut-panel__label-24">{t("Type")}</label>
            <select
              id="cut-connector-type-select"
              data-testid="cut-connector-type-select"
              value={defaultAttrs.type || 'plug'}
              disabled={isCutFinished}
              onChange={(e) => updateDefaultAttrs({ type: e.target.value as CutConnectorType })}
              className="ds-input cut-panel__select-23"
            >
              {connectorTypes.map((type) => (
                <option key={type} value={type}>
                  {t(type.charAt(0).toUpperCase() + type.slice(1))}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="cut-panel__label-24">{t("Shape")}</label>
            <select
              id="cut-connector-shape-select"
              data-testid="cut-connector-shape-select"
              value={isSnap ? 'circle' : (defaultAttrs.shape || 'circle')}
              disabled={isSnap || isCutFinished}
              onChange={(e) => updateDefaultAttrs({ shape: e.target.value as CutConnectorShape })}
              className={["ds-input cut-panel__select-29", (isSnap  ? "cut-panel__state-26" : "cut-panel__state-27"), (isSnap  ? "cut-panel__state-9" : "cut-panel__state-28")].join(" ")}
            >
              {connectorShapes.map((s) => (
                <option key={s} value={s}>
                  {t(s.charAt(0).toUpperCase() + s.slice(1))}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="cut-panel__label-24">{t("Style")}</label>
            <select
              id="cut-connector-style-select"
              data-testid="cut-connector-style-select"
              value={isSnap ? 'prism' : (defaultAttrs.style || 'prism')}
              disabled={isSnap || isCutFinished}
              onChange={(e) => updateDefaultAttrs({ style: e.target.value as CutConnectorStyle })}
              className={["ds-input cut-panel__select-29", (isSnap  ? "cut-panel__state-26" : "cut-panel__state-27"), (isSnap  ? "cut-panel__state-9" : "cut-panel__state-28")].join(" ")}
            >
              {connectorStyles.map((st) => (
                <option key={st} value={st}>
                  {t(st.charAt(0).toUpperCase() + st.slice(1))}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="cut-panel__label-24">{t("Size (ø mm)")}</label>
            <input
              id="cut-connector-size-input"
              data-testid="cut-connector-size-input"
              type="number"
              step={0.5}
              min={1}
              max={30}
              value={defaultAttrs.size ?? 3.0}
              disabled={isCutFinished}
              onChange={(e) => updateDefaultAttrs({ size: parseFloat(e.target.value) || 3.0 })}
              className="ds-input cut-panel__select-23"
            />
          </div>

          <div>
            <label className="cut-panel__label-24">{t("Depth (mm)")}</label>
            <input
              id="cut-connector-depth-input"
              data-testid="cut-connector-depth-input"
              type="number"
              step={0.5}
              min={1}
              max={50}
              value={defaultAttrs.depthRatio ?? 4.0}
              disabled={isCutFinished}
              onChange={(e) => updateDefaultAttrs({ depthRatio: parseFloat(e.target.value) || 4.0 })}
              className="ds-input cut-panel__select-23"
            />
          </div>

          <div>
            <label className="cut-panel__label-24">{t("Tolerance (mm)")}</label>
            <input
              id="cut-connector-tolerance-input"
              data-testid="cut-connector-tolerance-input"
              type="number"
              step={0.05}
              min={0}
              max={2}
              value={defaultAttrs.tolerance ?? 0.1}
              disabled={isCutFinished}
              onChange={(e) => updateDefaultAttrs({ tolerance: parseFloat(e.target.value) || 0.1 })}
              className="ds-input cut-panel__select-23"
            />
          </div>

          {isPlug && (
            <div className="cut-panel__div-25">
              <label className="cut-panel__label-24">{t("Target Half")}</label>
              <select
                id="cut-connector-target-half-select"
                data-testid="cut-connector-target-half-select"
                value={defaultAttrs.targetHalf || 'upper'}
                disabled={isCutFinished}
                onChange={(e) => updateDefaultAttrs({ targetHalf: e.target.value as 'upper' | 'lower' })}
                className="ds-input cut-panel__select-23"
              >
                <option value="upper">{t("Upper (plug in upper half, socket in lower)")}</option>
                <option value="lower">{t("Lower (plug in lower half, socket in upper)")}</option>
              </select>
            </div>
          )}
        </div>

        {/* Type-specific hints */}
        {isSnap && (
          <div className="cut-panel__div-22">
            {t("* Snap connector requires lower targetHalf, prism style, and circle shape.")}</div>
        )}
        {isDowel && (
          <div className="cut-panel__div-21">
            {t("* Dowels generate an independent pin object and negative sockets in both halves.")}</div>
        )}

        {/* Honest clearance notice with plain user wording */}
        {hasConnectors && (
          <div
            id="cut-connector-fit-notice"
            data-testid="cut-connector-fit-notice"
            className="cut-panel__card-20"
          >
            {t("Inspect connector clearance in sliced preview.")}</div>
        )}

        {/* Connectors List */}
        {connectors.length > 0 && (
          <div
            id="cut-connectors-list"
            className="cut-panel__div-19"
          >
            {connectors.map((conn, idx) => {
              const isSelected = selectedConnectorIndex === idx;
              const issue = issues[idx];
              return (
                <div
                  key={conn.id || idx}
                  data-testid="cut-connector-row"
                  data-invalid={issue ? issue : undefined}
                  onClick={() => selectConnector(idx)}
                  aria-selected={isSelected}
                  className={["cut-panel__row-18", isSelected ? "cut-panel__state-16" : "cut-panel__state-17", issue ? "cut-panel__invalid" : isSelected ? "cut-panel__selected" : "cut-panel__unselected"].join(" ")}
                >
                  <div className="cut-panel__row-15">
                    <span className="cut-panel__state-9">#{idx + 1}</span>
                    <span className="cut-panel__span-14">
                      {t((conn.attrs?.type || 'plug').replace(/^./, c => c.toUpperCase()))} ({t((conn.attrs?.shape || 'circle').replace(/^./, c => c.toUpperCase()))})
                    </span>
                    <span className="cut-panel__span-13">
                      ø{conn.attrs?.size ?? 3} h{conn.attrs?.depthRatio ?? 4}
                      {conn.attrs?.type === 'plug' ? ` [${conn.attrs?.targetHalf || 'upper'}]` : ''}
                      {issue && <span className="cut-panel__span-12">{issue === "outside" ? t("off the cut face") : issue === "edge" ? t("crosses the edge") : t("overlaps")}</span>}
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeConnector(idx);
                    }}
                    disabled={isCutFinished}
                    className={["ds-btn cut-panel__button-11", (isCutFinished  ? "cut-panel__state-9" : "cut-panel__state-10"), (isCutFinished  ? "cut-panel__state-4" : "cut-panel__state-5")].join(" ")}
                    title={t("Remove connector")}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Error Message Banner */}
      {error && (
        <div
          id="cut-error-message"
          data-testid="cut-error-message"
          className="cut-panel__card-8"
        >
          {t(error)}
        </div>
      )}

      {/* Action Buttons */}
      <div className="cut-panel__actions">
        <button
          id="perform-cut-btn"
          data-testid="perform-cut-btn"
          onClick={performCut}
          disabled={isCutting || isCutFinished || (!keepUpper && !keepLower) || hasInvalidConnector}
          className={["ds-btn ds-btn--primary cut-panel__button-6", ((isCutting || isCutFinished)  ? "cut-panel__state-4" : "cut-panel__state-5")].join(" ")}
        >
          {isCutFinished ? t('Cut Completed') : isCutting ? t('Cutting...') : t('Perform cut')}
        </button>
        <button
          id="cut-cancel-btn"
          data-testid="cut-cancel-btn"
          onClick={closeCut}
          disabled={isCutting}
          className="ds-btn cut-panel__button-3"
        >
          {isCutFinished ? t('Done') : t('Cancel')}
        </button>
      </div>

      {/* Success Notification with plain user wording */}
      {lastResult && lastResult.success && (
        <div
          id="cut-success-message"
          data-testid="cut-success-message"
          className="cut-panel__card-2"
        >
          <div>
            {t("Cut successful! Produced")}{lastResult.createdObjects?.length ?? 0} {t("object(s) with")}{' '}
            {lastResult.connectorCount ?? 0} {t("connector(s).")}</div>
          <div className="cut-panel__div-1">
            {t("Inspect connector clearance in sliced preview.")}</div>
        </div>
      )}
    </div>
  );
};

export default CutPanel;
