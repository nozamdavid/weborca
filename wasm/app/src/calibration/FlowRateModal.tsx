import './FlowRateModal.css';
/**
 * @file FlowRateModal.tsx
 * Modal dialog for Flow Rate Calibration test generation and flow evaluation calculator.
 */

import React from 'react';
import { useCalibrationStore } from './calibrationStore';
import type { InfillPattern } from './types';
import { Dialog } from "../components/Dialog";
import { useTranslation } from "../i18n";

export const FlowRateModal: React.FC = () => {
    const { t } = useTranslation();
  const {
    isOpen,
    closeDialog,
    activeTab,
    setActiveTab,
    selectedPass,
    setSelectedPass,
    selectedPattern,
    setSelectedPattern,
    showConfirmReplace,
    isCalibrating,
    statusMessage,
    errorMessage,
    calculatorModifier,
    setCalculatorModifier,
    customOldFlow,
    setCustomOldFlow,
    calculatedNewFlow,
    calculatorMessage,
    applyCalculatedFlow,
    startCalibration,
    confirmReplaceAndStart,
    cancelConfirmReplace
  } = useCalibrationStore();

  if (!isOpen) return null;

  return (
    <Dialog className="ds-scrim" role="dialog" aria-modal="true" aria-label={t("Flow Rate Calibration")} onClose={closeDialog} data-testid="calibration-dialog" id="calibration-dialog">
      <div
        className="ds-dialog flow-rate-panel"
      >
        {/* Header */}
        <div className="ds-dialog__head">
          <h2 className="ds-title ds-title--dialog">{t("Flow Rate Calibration")}</h2>
          <button
            type="button"
            className="ds-icon-btn"
            data-testid="calib-close-btn"
            onClick={closeDialog}
            aria-label={t("Close Calibration dialog")}
          >
            ✕
          </button>
        </div>

        {/* Tab navigation */}
        <div
          className="flow-rate-panel__tabs"
        >
          <button
            type="button"
            data-testid="calib-tab-generator"
            className={["ds-btn flowrate-modal__button-44", (activeTab === 'generator'  ? "flowrate-modal__state-37" : "flowrate-modal__state-38"), (activeTab === 'generator'  ? "flowrate-modal__state-39" : "flowrate-modal__state-40"), (activeTab === 'generator'  ? "flowrate-modal__span-25" : "flowrate-modal__state-41"), (activeTab === 'generator'  ? "flowrate-modal__state-42" : "flowrate-modal__state-43")].join(" ")}
            onClick={() => setActiveTab('generator')}
          >
            {t("Test Generator")}</button>
          <button
            type="button"
            data-testid="calib-tab-calculator"
            className={["ds-btn flowrate-modal__button-44", (activeTab === 'calculator'  ? "flowrate-modal__state-37" : "flowrate-modal__state-38"), (activeTab === 'calculator'  ? "flowrate-modal__state-39" : "flowrate-modal__state-40"), (activeTab === 'calculator'  ? "flowrate-modal__span-25" : "flowrate-modal__state-41"), (activeTab === 'calculator'  ? "flowrate-modal__state-42" : "flowrate-modal__state-43")].join(" ")}
            onClick={() => setActiveTab('calculator')}
          >
            {t("Flow Rate Calculator")}</button>
        </div>

        {/* Body */}
        <div className="ds-dialog__body flowrate-modal__div-36">
          {errorMessage && (
            <div
              data-testid="calib-error-message"
              className="flowrate-modal__card-35"
            >
              {t(errorMessage)}
            </div>
          )}

          {statusMessage && (
            <div
              data-testid="calib-status-message"
              className="flowrate-modal__card-34"
            >
              {t(statusMessage)}
            </div>
          )}

          {activeTab === 'generator' && (
            <div>
              {/* Test Type Selection */}
              <div className="flowrate-modal__div-23">
                <label className="flowrate-modal__label-33">
                  {t("Calibration Pass")}</label>
                <div className="flowrate-modal__row-32">
                  <label
                    className={["flowrate-modal__label-31", (selectedPass === 1  ? "flowrate-modal__state-27" : "flowrate-modal__state-28"), (selectedPass === 1  ? "flowrate-modal__state-29" : "flowrate-modal__state-30")].join(" ")}
                  >
                    <div className="flowrate-modal__row-26">
                      <input
                        type="radio"
                        name="calib-pass"
                        data-testid="calib-pass1-btn"
                        checked={selectedPass === 1}
                        onChange={() => setSelectedPass(1)}
                        disabled={isCalibrating}
                      />
                      <span className="flowrate-modal__span-25">{t("Pass 1 (Coarse)")}</span>
                    </div>
                    <span className="flowrate-modal__span-24">
                      {t("Range: -20% to +20% (step 5%) · 9 chips")}</span>
                  </label>

                  <label
                    className={["flowrate-modal__label-31", (selectedPass === 2  ? "flowrate-modal__state-27" : "flowrate-modal__state-28"), (selectedPass === 2  ? "flowrate-modal__state-29" : "flowrate-modal__state-30")].join(" ")}
                  >
                    <div className="flowrate-modal__row-26">
                      <input
                        type="radio"
                        name="calib-pass"
                        data-testid="calib-pass2-btn"
                        checked={selectedPass === 2}
                        onChange={() => setSelectedPass(2)}
                        disabled={isCalibrating}
                      />
                      <span className="flowrate-modal__span-25">{t("Pass 2 (Fine)")}</span>
                    </div>
                    <span className="flowrate-modal__span-24">
                      {t("Range: -9% to 0% (step 1%) · Fine tuning")}</span>
                  </label>
                </div>
              </div>

              {/* Surface Pattern */}
              <div className="flowrate-modal__div-23">
                <label
                  htmlFor="calib-pattern-select"
                  className="flowrate-modal__label-22"
                >
                  {t("Top Surface Pattern")}</label>
                <select
                  id="calib-pattern-select"
                  data-testid="calib-pattern-select"
                  value={selectedPattern}
                  onChange={(e) => setSelectedPattern(e.target.value as InfillPattern)}
                  disabled={isCalibrating}
                  className="ds-input flowrate-modal__input-12"
                >
                  <option value="archimedeanchords">{t("Archimedean Chords (Recommended)")}</option>
                  <option value="monotonic">{t("Monotonic")}</option>
                </select>
                <span className="flowrate-modal__span-21">
                  {t("Archimedean Chords creates a distinct center spiral lip that tactilely reveals over/under-extrusion.")}</span>
              </div>

              {/* Replacement confirmation alert */}
              {showConfirmReplace && (
                <div
                  data-testid="calib-confirm-banner"
                  className="flowrate-modal__card-20"
                >
                  <div className="flowrate-modal__div-19">{t("Replace current plate?")}</div>
                  <div className="flowrate-modal__div-18">
                    {t("Objects are currently loaded on the build plate. Generating calibration will replace the plate with test chips.\n                    You can restore your current project at any time using Undo (Ctrl+Z).")}</div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'calculator' && (
            <div>
              <p className="flowrate-modal__p-15">
                {t("Print the calibration plate and inspect the top surface of the chips with your finger.\n                Select the chip with the smoothest surface without gaps or rough over-extrusion ridges.")}</p>

              {/* Current flow ratio */}
              <div className="flowrate-modal__div-14">
                <label className="flowrate-modal__label-13">
                  {t("Current Flow Ratio:")}</label>
                <input
                  type="number"
                  step="0.01"
                  id="calib-calc-current" data-testid="calib-calc-current"
                  value={customOldFlow}
                  onChange={(e) => setCustomOldFlow(e.target.value === '' ? '' : parseFloat(e.target.value))}
                  className="ds-input flowrate-modal__input-12"
                />
              </div>

              {/* Modifier input */}
              <div className="flowrate-modal__div-14">
                <label className="flowrate-modal__label-13">
                  {t("Selected Chip Modifier (%):")}</label>
                <input
                  type="number"
                  id="calib-calc-modifier"
                  data-testid="calib-calc-modifier"
                  placeholder={t("e.g. 5, -5, 0, -10")}
                  value={calculatorModifier}
                  onChange={(e) => setCalculatorModifier(e.target.value === '' ? '' : parseFloat(e.target.value))}
                  className="ds-input flowrate-modal__input-12"
                />
                <span className="flowrate-modal__span-11">
                  {t("Enter the chip label number (e.g. 5 for +5%, -10 for -10%).")}</span>
              </div>

              {/* Calculated Result Card */}
              <div
                className="flowrate-modal__card-10"
              >
                <div className="flowrate-modal__div-9">
                  {t("Formula:")}<code className="flowrate-modal__code-8">{t("New Flow = Old Flow × (100 + Modifier) / 100")}</code>
                </div>
                <div className="flowrate-modal__row-7">
                  <span className="flowrate-modal__span-6">{t("New Flow Ratio:")}</span>
                  <span
                    id="calib-calc-result"
                    data-testid="calib-calc-result"
                    className={["flowrate-modal__span-5", (calculatedNewFlow !== null  ? "flowrate-modal__state-3" : "flowrate-modal__state-4")].join(" ")}
                  >
                    {calculatedNewFlow !== null ? calculatedNewFlow.toFixed(4) : '--'}
                  </span>
                </div>
              </div>

              {calculatorMessage && (
                <div
                  data-testid="calib-calc-message"
                  className="flowrate-modal__card-2"
                >
                  {t(calculatorMessage)}
                </div>
              )}
            </div>
          )}
        </div>
        {activeTab === 'generator' && !showConfirmReplace && (
                <div className="ds-dialog__foot flowrate-modal__row-16">
                  <button
                    type="button"
                    className="ds-btn"
                    onClick={closeDialog}
                    disabled={isCalibrating}
                  >
                    {t("Close")}</button>
                  <button
                    type="button"
                    id="calib-generate-btn"
                    data-testid="calib-generate-btn"
                    className="ds-btn ds-btn--primary"
                    onClick={startCalibration}
                    disabled={isCalibrating}
                  >
                    {isCalibrating ? t('Loading...') : t('Generate Calibration Plate')}
                  </button>
                </div>
              )}
        {activeTab === 'calculator' && (<div className="ds-dialog__foot flowrate-modal__row-1">
                <button
                  type="button"
                  className="ds-btn"
                  onClick={closeDialog}
                >
                  {t("Close")}</button>
                <button
                  type="button"
                  id="calib-calc-apply"
                  data-testid="calib-calc-apply"
                  className="ds-btn ds-btn--primary"
                  onClick={applyCalculatedFlow}
                  disabled={calculatedNewFlow === null}
                >
                  {t("Apply Flow Ratio")}</button>
              </div>)}
        {activeTab === 'generator' && showConfirmReplace && (<div className="ds-dialog__foot flowrate-modal__row-17">
                    <button
                      type="button"
                      id="calib-confirm-cancel"
                      data-testid="calib-confirm-cancel"
                      className="ds-btn"
                      onClick={cancelConfirmReplace}
                      disabled={isCalibrating}
                    >
                      {t("Cancel")}</button>
<button
                      type="button"
                      id="calib-confirm-proceed"
                      data-testid="calib-confirm-proceed"
                      className="ds-btn ds-btn--primary"
                      onClick={confirmReplaceAndStart}
                      disabled={isCalibrating}
                    >
                      {t("Proceed")}</button>
                    
                  </div>)}
      </div>
    </Dialog>
  );
};
