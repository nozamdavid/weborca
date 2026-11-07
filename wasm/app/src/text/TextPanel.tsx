import './TextPanel.css';
/**
 * @file TextPanel.tsx
 * Floating control panel for 3D Text & Emboss tool in OrcaSlicer Web.
 * Mirrors desktop OrcaSlicer GLGizmoEmboss controls:
 * multi-line text input, font picker, size/depth sliders, char/line gap,
 * bold/skew, alignment, surface projection toggle, and volume type selector.
 */

import React, { useEffect, useRef } from 'react';
import { useTextStore } from './textStore';
import type { TextVolumeType } from './types';
import { useTranslation } from "../i18n";

export const TextPanel: React.FC = () => {
    const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Text store state
  const isOpen = useTextStore((s) => s.isOpen);
  const targetObjectId = useTextStore((s) => s.targetObjectId);
  const targetVolumeId = useTextStore((s) => s.targetVolumeId);
  const text = useTextStore((s) => s.text);
  const selectedFont = useTextStore((s) => s.selectedFont);
  const fontMissingName = useTextStore((s) => s.fontMissingName);
  const size = useTextStore((s) => s.size);
  const depth = useTextStore((s) => s.depth);
  const charGap = useTextStore((s) => s.charGap);
  const lineGap = useTextStore((s) => s.lineGap);
  const boldness = useTextStore((s) => s.boldness);
  const skew = useTextStore((s) => s.skew);
  const align = useTextStore((s) => s.align);
  const volumeType = useTextStore((s) => s.volumeType);
  const rotation = useTextStore((s) => s.rotation);
  const useSurface = useTextStore((s) => s.useSurface);
  const fonts = useTextStore((s) => s.fonts);
  const isFontsLoaded = useTextStore((s) => s.isFontsLoaded);
  const isLoading = useTextStore((s) => s.isLoading);
  const error = useTextStore((s) => s.error);

  // Actions
  const close = useTextStore((s) => s.close);
  const setText = useTextStore((s) => s.setText);
  const setFont = useTextStore((s) => s.setFont);
  const setSize = useTextStore((s) => s.setSize);
  const setDepth = useTextStore((s) => s.setDepth);
  const setCharGap = useTextStore((s) => s.setCharGap);
  const setLineGap = useTextStore((s) => s.setLineGap);
  const setBoldness = useTextStore((s) => s.setBoldness);
  const setSkew = useTextStore((s) => s.setSkew);
  const setAlign = useTextStore((s) => s.setAlign);
  const setVolumeType = useTextStore((s) => s.setVolumeType);
  const setRotation = useTextStore((s) => s.setRotation);
  const setUseSurface = useTextStore((s) => s.setUseSurface);
  const setError = useTextStore((s) => s.setError);
  const resetParams = useTextStore((s) => s.resetParams);
  const loadFonts = useTextStore((s) => s.loadFonts);
  const loadCustomFontFile = useTextStore((s) => s.loadCustomFontFile);
  const addText = useTextStore((s) => s.addText);
  const updateText = useTextStore((s) => s.updateText);

  // Preload font manifest when opened
  useEffect(() => {
    if (isOpen && !isFontsLoaded) {
      void loadFonts();
    }
  }, [isOpen, isFontsLoaded, loadFonts]);

  if (!isOpen) {
    return null;
  }

  const isEditing = targetVolumeId !== null;

  const handleFontSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const fontId = e.target.value;
    const font = fonts.find((f) => f.id === fontId);
    if (font) {
      void setFont(font);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        await loadCustomFontFile(file);
      } catch (err: any) {
        setError(err?.message || 'Failed to load font file');
      }
    }
    // reset input value so re-uploading the same font file triggers onChange
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const isBold = boldness > 0.05;
  const isItalic = Math.abs(skew) > 0.05;

  return (
    <div
      id="text-emboss-panel"
      data-testid="text-emboss-panel"
      role="region"
      aria-label={t("3D Text and Emboss Tool")}
      className="ds-float text-panel"
    >
      {/* Header */}
      <div
        className="text-panel__head"
      >
        <div className="text-panel__row-26">
          <span className="text-panel__span-63">{t("🔤")}</span>
          <strong id="text-panel-title" className="ds-title ds-title--panel text-panel__title">
            {isEditing ? t('Edit 3D Text') : t('Text')}
          </strong>
          {isEditing && (
            <span
              className="text-panel__span-61"
            >
              {targetObjectId !== null ? `${t('Object')} #${targetObjectId} • ` : ''}{t("Vol #")}{targetVolumeId}
            </span>
          )}
        </div>
        <button
          id="close-text-btn"
          data-testid="close-text-btn"
          onClick={close}
          title={t("Close text tool")}
          className="ds-btn text-panel__button-60"
        >
          ✕
        </button>
      </div>

      {/* Recoverable Missing Font Banner across sessions */}
      {fontMissingName && (
        <div
          id="font-reselect-banner"
          data-testid="font-reselect-banner"
          role="alert"
          className="text-panel__card-59"
        >
          <div className="text-panel__row-58">
            <span>{t("⚠️")}</span>
            <strong className="text-panel__strong-57">{t("Custom Font Required")}</strong>
          </div>
          <div className="text-panel__div-56">
            {t("Font")}<strong>"{fontMissingName}"</strong> {t("is not embedded in the 3MF project archive. Please reselect the font file to edit text geometry.")}</div>
          <button
            id="reselect-font-btn"
            data-testid="reselect-font-btn"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="ds-btn text-panel__button-55"
          >
            {t("📁 Reselect Font File…")}</button>
        </div>
      )}

      {/* Engine Error Banner */}
      {error && !fontMissingName && (
        <div
          id="text-error-banner"
          data-testid="text-error-banner"
          role="alert"
          className="text-panel__row-54"
        >
          <div className="text-panel__row-26">
            <span>{t("⚠️")}</span>
            <span id="text-error-message">{t(error)}</span>
          </div>
          <button
            id="dismiss-text-error-btn"
            onClick={() => setError(null)}
            className="ds-btn text-panel__button-53"
          >
            {t("Dismiss")}</button>
        </div>
      )}

      {/* Text String Input (Multi-line) */}
      <div className="text-panel__div-38">
        <label
          htmlFor="text-input"
          className="text-panel__label-52"
        >
          {t("Text:")}</label>
        <textarea
          id="text-input"
          data-testid="text-input"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("Enter text...")}
          className="ds-input text-panel__textarea-51"
        />
      </div>

      {/* Font Select & Load Font File */}
      <div className="text-panel__div-38">
        <div
          className="text-panel__row-50"
        >
          <label
            htmlFor="font-select"
            className="text-panel__span-36"
          >
            {t("Font:")}</label>
          <button
            id="load-font-btn"
            data-testid="load-font-btn"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title={t("Load custom TrueType / OpenType font file (.ttf, .otf)")}
            className="ds-btn text-panel__button-49"
          >
            {t("📁 Load font file…")}</button>
          <input
            ref={fileInputRef}
            id="custom-font-file-input"
            data-testid="custom-font-file-input"
            type="file"
            accept=".ttf,.otf,.ttc"
            onChange={handleFileChange}
            className="text-panel__input-48"
          />
        </div>
        <select
          id="font-select"
          data-testid="font-select"
          value={selectedFont?.id || ''}
          onChange={handleFontSelect}
          className={["ds-input text-panel__select-47", (fontMissingName && !selectedFont  ? "text-panel__state-46" : "text-panel__state-14")].join(" ")}
        >
          {fontMissingName && !selectedFont && (
            <option value="" disabled>
              {t("⚠️ Select font (")}{fontMissingName})
            </option>
          )}
          {fonts.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} {f.license ? `(${f.license})` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Dimensions: Size & Depth */}
      <div className="text-panel__grid-42">
        <div>
          <div className="text-panel__row-41">
            <span className="text-panel__state-12">{t("Size:")}</span>
            <span id="text-size-val" className="text-panel__span-40">
              {size.toFixed(1)} {t("mm")}</span>
          </div>
          <input
            id="size-slider"
            data-testid="size-slider"
            type="range"
            min="1.0"
            max="60.0"
            step="0.5"
            value={size}
            onChange={(e) => setSize(parseFloat(e.target.value))}
            className="text-panel__input-39"
          />
        </div>

        <div>
          <div className="text-panel__row-41">
            <span className="text-panel__state-12">{t("Depth:")}</span>
            <span id="text-depth-val" className="text-panel__span-40">
              {depth.toFixed(2)} {t("mm")}</span>
          </div>
          <input
            id="depth-slider"
            data-testid="depth-slider"
            type="range"
            min="0.1"
            max="15.0"
            step="0.1"
            value={depth}
            onChange={(e) => setDepth(parseFloat(e.target.value))}
            className="text-panel__input-39"
          />
        </div>
      </div>


      {/* Spacing: Character Gap & Line Gap */}
      <div className="text-panel__grid-42">
        <div>
          <div className="text-panel__row-41">
            <span className="text-panel__state-12">{t("Char Gap:")}</span>
            <span id="text-char-gap-val" className="text-panel__state-12">
              {charGap} {t("pt")}</span>
          </div>
          <input
            id="char-gap-slider"
            data-testid="char-gap-slider"
            type="range"
            min="-20"
            max="50"
            step="1"
            value={charGap}
            onChange={(e) => setCharGap(parseInt(e.target.value, 10))}
            className="text-panel__input-39"
          />
        </div>

        <div>
          <div className="text-panel__row-41">
            <span className="text-panel__state-12">{t("Line Gap:")}</span>
            <span id="text-line-gap-val" className="text-panel__state-12">
              {lineGap} {t("pt")}</span>
          </div>
          <input
            id="line-gap-slider"
            data-testid="line-gap-slider"
            type="range"
            min="-20"
            max="50"
            step="1"
            value={lineGap}
            onChange={(e) => setLineGap(parseInt(e.target.value, 10))}
            className="text-panel__input-39"
          />
        </div>
      </div>

      {/* Rotation Angle */}
      <div className="text-panel__div-38">
        <div className="text-panel__row-41">
          <span className="text-panel__state-12">{t("Rotation:")}</span>
          <span id="text-rotation-val" data-testid="text-rotation-val" className="text-panel__span-40">
            {rotation.toFixed(0)}°
          </span>
        </div>
        <input
          id="rotation-slider"
          data-testid="rotation-slider"
          type="range"
          min="-180"
          max="180"
          step="5"
          value={rotation}
          onChange={(e) => setRotation(parseFloat(e.target.value))}
          className="text-panel__input-39"
        />
      </div>

      {/* Style & Alignment Controls */}
      <div className="text-panel__div-38">
        <div className="text-panel__row-37">
          <span className="text-panel__span-36">{t("Style & Align:")}</span>

          {/* Bold and Italic toggles */}
          <div className="text-panel__row-35">
            <button
              id="bold-btn"
              aria-pressed={isBold}
              data-testid="bold-btn"
              type="button"
              onClick={() => setBoldness(isBold ? 0.0 : 0.2)}
              title={t("Toggle Bold style")}
              className={["ds-btn text-panel__button-34", (isBold  ? "text-panel__state-9" : "text-panel__state-32")].join(" ")}
            >
              B
            </button>
            <button
              id="italic-btn"
              aria-pressed={isItalic}
              data-testid="italic-btn"
              type="button"
              onClick={() => setSkew(isItalic ? 0.0 : 0.25)}
              title={t("Toggle Italic / Skew style")}
              className={["ds-btn text-panel__button-33", (isItalic  ? "text-panel__state-9" : "text-panel__state-32")].join(" ")}
            >
              I
            </button>
          </div>
        </div>

        {/* Alignment Buttons */}
        <div className="text-panel__grid-31">
          {/* Horizontal Alignment */}
          <div
            id="horizontal-align-group"
            className="text-panel__row-30"
          >
            {(['left', 'center', 'right'] as const).map((h) => {
              const active = align.horizontal === h;
              return (
                <button
                  key={h}
                  id={`align-${h}-btn`}
                  aria-pressed={active}
                  type="button"
                  onClick={() => setAlign({ ...align, horizontal: h })}
                  title={t(h.charAt(0).toUpperCase() + h.slice(1))}
                  className={["ds-btn text-panel__button-29", (active  ? "text-panel__state-9" : "text-panel__state-28"), (active  ? "text-panel__state-11" : "text-panel__state-12")].join(" ")}
                >
                  {h === "left" ? "⇤" : h === "center" ? "⇥⇤" : "⇥"}
                </button>
              );
            })}
          </div>

          {/* Vertical Alignment */}
          <div
            id="vertical-align-group"
            className="text-panel__row-30"
          >
            {(['top', 'center', 'bottom'] as const).map((v) => {
              const active = align.vertical === v;
              return (
                <button
                  key={v}
                  id={`align-v-${v}-btn`}
                  aria-pressed={active}
                  type="button"
                  onClick={() => setAlign({ ...align, vertical: v })}
                  title={t(v.charAt(0).toUpperCase() + v.slice(1))}
                  className={["ds-btn text-panel__button-29", (active  ? "text-panel__state-9" : "text-panel__state-28"), (active  ? "text-panel__state-11" : "text-panel__state-12")].join(" ")}
                >
                  {v === "top" ? "↥" : v === "center" ? "⬍" : "↧"}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Curved Surface Text Wrapping (Conform to Surface) */}
      {(() => {
        const isUnattached = targetObjectId === null || volumeType === 'new_object';
        const handleUseSurfaceToggle = (checked: boolean) => {
          if (checked && isUnattached) {
            setError("Select a model on the build plate to wrap text onto its surface.");
            return;
          }
          setUseSurface(checked);
        };
        return (
          <div
            className={["text-panel__row-27", isUnattached ? "text-panel__row-27--disabled" : ""].filter(Boolean).join(" ")}
            title={
              isUnattached
                ? t("Select a model on the build plate to wrap text onto its surface.")
                : t("Wrap text geometry onto the curved surface of the target model.")
            }
          >
            <div>
              <div className="text-panel__row-26">
                <label
                  htmlFor="use-surface-checkbox"
                  className={["text-panel__label-25", isUnattached ? "text-panel__label-25--disabled" : ""].filter(Boolean).join(" ")}
                >
                  {t("Use surface")}
                </label>
                <span
                  id="surface-mode-badge"
                  className="text-panel__span-24"
                >
                  {isUnattached ? t("Requires Target Model") : useSurface ? t("Curved Wrap") : t("Planar")}
                </span>
              </div>
              <div className="text-panel__div-23">
                {isUnattached
                  ? t("Select a model on the build plate to wrap text onto its surface.")
                  : t("Wrap text geometry onto the curved surface of the target model.")}
              </div>
            </div>
            <div className="text-panel__switch-wrapper">
              <input
                id="use-surface-checkbox"
                data-testid="use-surface-checkbox"
                type="checkbox"
                role="switch"
                aria-checked={useSurface}
                aria-label={t("Use surface")}
                checked={useSurface}
                disabled={isUnattached}
                onChange={(e) => handleUseSurfaceToggle(e.target.checked)}
                className="ds-switch text-panel__input-22"
              />
              <input
                id="surface-toggle"
                data-testid="surface-toggle"
                type="checkbox"
                aria-hidden="true"
                checked={useSurface}
                disabled={isUnattached}
                onChange={(e) => handleUseSurfaceToggle(e.target.checked)}
                tabIndex={-1}
              />
            </div>
          </div>
        );
      })()}
      {/* Volume Type Selector */}
      <div className="text-panel__div-21">
        <span className="text-panel__span-20">
          {t("Operation / Type:")}</span>
        {targetObjectId === null ? (
          <div
            id="volume-type-unattached"
            data-testid="volume-type-unattached"
            className="text-panel__row-19"
          >
            <span>✨</span>
            <span>{t("New Object on Print Bed (No parent object selected)")}</span>
          </div>
        ) : (
          <div
            id="volume-type-selector"
            data-testid="volume-type-selector"
            className="text-panel__grid-18"
          >
            {(
              [
                { type: 'part', label: t("Part (Join)") },
                { type: 'negative', label: t("Cut (Negative)") },
                { type: 'modifier', label: t("Modifier") }
              ] as const
            ).map((item) => {
              const active = volumeType === item.type;
              return (
                <button
                  key={item.type}
                  id={`type-${item.type}-btn`}
                  aria-pressed={active}
                  data-testid={`type-${item.type}-btn`}
                  type="button"
                  onClick={() => setVolumeType(item.type as TextVolumeType)}
                  className={["ds-btn text-panel__button-17", (active  ? "text-panel__state-9" : "text-panel__state-10"), (active  ? "text-panel__state-11" : "text-panel__state-12"), (active  ? "text-panel__state-13" : "text-panel__state-14"), (active  ? "text-panel__state-15" : "text-panel__state-16")].join(" ")}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Action Footer Buttons */}
      <div className="text-panel__row-8">
        {isEditing ? (
          <button
            id="update-text-btn"
            data-testid="update-text-btn"
            type="button"
            disabled={isLoading || (!!fontMissingName && !selectedFont)}
            onClick={() => void updateText(true)}
            className={["ds-btn text-panel__button-7", (isLoading || (!!fontMissingName && !selectedFont)  ? "text-panel__state-3" : "text-panel__state-4"), (isLoading || (!!fontMissingName && !selectedFont)  ? "text-panel__state-5" : "text-panel__state-6")].join(" ")}
          >
            {isLoading ? t('Updating...') : t('Update')}
          </button>
        ) : (
          <button
            id="add-text-btn"
            data-testid="add-text-btn"
            type="button"
            disabled={isLoading || (!!fontMissingName && !selectedFont)}
            onClick={() => void addText()}
            className={["ds-btn text-panel__button-7", (isLoading || (!!fontMissingName && !selectedFont)  ? "text-panel__state-3" : "text-panel__state-4"), (isLoading || (!!fontMissingName && !selectedFont)  ? "text-panel__state-5" : "text-panel__state-6")].join(" ")}
          >
            {isLoading ? t('Loading...') : t('Add')}
          </button>
        )}

        <button
          id="reset-text-btn"
          data-testid="reset-text-btn"
          type="button"
          disabled={isLoading}
          onClick={resetParams}
          title={t("Reset options to defaults")}
          className="ds-btn text-panel__button-2"
        >
          {t("Reset")}</button>

        <button
          id="close-panel-btn"
          data-testid="close-panel-btn"
          type="button"
          onClick={close}
          className="ds-btn text-panel__button-1"
        >
          {t("Close")}</button>
      </div>
    </div>
  );
};
