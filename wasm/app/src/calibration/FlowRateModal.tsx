/**
 * @file FlowRateModal.tsx
 * Modal dialog for Flow Rate Calibration test generation and flow evaluation calculator.
 */

import React from 'react';
import { useCalibrationStore } from './calibrationStore';
import type { InfillPattern } from './types';
import { ModalBackdrop } from '../components/ModalBackdrop';

export const FlowRateModal: React.FC = () => {
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
    <ModalBackdrop onClose={closeDialog} data-testid="calibration-dialog" id="calibration-dialog">
      <div
        className="modal-box preset-modal"
        style={{
          width: 540,
          maxWidth: '92vw',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title">Flow Rate Calibration</div>
          <button
            type="button"
            className="modal-close-btn"
            data-testid="calib-close-btn"
            onClick={closeDialog}
            aria-label="Close Calibration dialog"
          >
            ✕
          </button>
        </div>

        {/* Tab navigation */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid #3f3f46',
            background: '#27272a'
          }}
        >
          <button
            type="button"
            data-testid="calib-tab-generator"
            style={{
              padding: '8px 16px',
              border: 'none',
              background: activeTab === 'generator' ? '#3f3f46' : 'transparent',
              color: activeTab === 'generator' ? '#fff' : '#a1a1aa',
              fontWeight: activeTab === 'generator' ? 600 : 400,
              cursor: 'pointer',
              borderBottom: activeTab === 'generator' ? '2px solid #38bdf8' : '2px solid transparent'
            }}
            onClick={() => setActiveTab('generator')}
          >
            Test Generator
          </button>
          <button
            type="button"
            data-testid="calib-tab-calculator"
            style={{
              padding: '8px 16px',
              border: 'none',
              background: activeTab === 'calculator' ? '#3f3f46' : 'transparent',
              color: activeTab === 'calculator' ? '#fff' : '#a1a1aa',
              fontWeight: activeTab === 'calculator' ? 600 : 400,
              cursor: 'pointer',
              borderBottom: activeTab === 'calculator' ? '2px solid #38bdf8' : '2px solid transparent'
            }}
            onClick={() => setActiveTab('calculator')}
          >
            Flow Rate Calculator
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1 }}>
          {errorMessage && (
            <div
              data-testid="calib-error-message"
              style={{
                marginBottom: 12,
                padding: '8px 12px',
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid #ef4444',
                borderRadius: 4,
                color: '#fca5a5',
                fontSize: '0.85rem'
              }}
            >
              {errorMessage}
            </div>
          )}

          {statusMessage && (
            <div
              data-testid="calib-status-message"
              style={{
                marginBottom: 12,
                padding: '8px 12px',
                background: 'rgba(59, 130, 246, 0.15)',
                border: '1px solid #3b82f6',
                borderRadius: 4,
                color: '#93c5fd',
                fontSize: '0.85rem'
              }}
            >
              {statusMessage}
            </div>
          )}

          {activeTab === 'generator' && (
            <div>
              {/* Test Type Selection */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: 8, fontSize: '0.9rem' }}>
                  Calibration Pass
                </label>
                <div style={{ display: 'flex', gap: 12 }}>
                  <label
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      padding: '10px 14px',
                      background: selectedPass === 1 ? 'rgba(56, 189, 248, 0.1)' : '#18181b',
                      border: selectedPass === 1 ? '1px solid #38bdf8' : '1px solid #3f3f46',
                      borderRadius: 6,
                      cursor: 'pointer'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <input
                        type="radio"
                        name="calib-pass"
                        data-testid="calib-pass1-btn"
                        checked={selectedPass === 1}
                        onChange={() => setSelectedPass(1)}
                        disabled={isCalibrating}
                      />
                      <span style={{ fontWeight: 600 }}>Pass 1 (Coarse)</span>
                    </div>
                    <span style={{ fontSize: '0.78rem', color: '#a1a1aa' }}>
                      Range: -20% to +20% (step 5%) · 9 chips
                    </span>
                  </label>

                  <label
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      padding: '10px 14px',
                      background: selectedPass === 2 ? 'rgba(56, 189, 248, 0.1)' : '#18181b',
                      border: selectedPass === 2 ? '1px solid #38bdf8' : '1px solid #3f3f46',
                      borderRadius: 6,
                      cursor: 'pointer'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <input
                        type="radio"
                        name="calib-pass"
                        data-testid="calib-pass2-btn"
                        checked={selectedPass === 2}
                        onChange={() => setSelectedPass(2)}
                        disabled={isCalibrating}
                      />
                      <span style={{ fontWeight: 600 }}>Pass 2 (Fine)</span>
                    </div>
                    <span style={{ fontSize: '0.78rem', color: '#a1a1aa' }}>
                      Range: -9% to 0% (step 1%) · Fine tuning
                    </span>
                  </label>
                </div>
              </div>

              {/* Surface Pattern */}
              <div style={{ marginBottom: 16 }}>
                <label
                  htmlFor="calib-pattern-select"
                  style={{ display: 'block', fontWeight: 600, marginBottom: 6, fontSize: '0.9rem' }}
                >
                  Top Surface Pattern
                </label>
                <select
                  id="calib-pattern-select"
                  data-testid="calib-pattern-select"
                  className="preset-select"
                  value={selectedPattern}
                  onChange={(e) => setSelectedPattern(e.target.value as InfillPattern)}
                  disabled={isCalibrating}
                  style={{ width: '100%', padding: '6px 10px', background: '#18181b', color: '#e4e4e7', border: '1px solid #3f3f46', borderRadius: 4 }}
                >
                  <option value="archimedeanchords">Archimedean Chords (Recommended)</option>
                  <option value="monotonic">Monotonic</option>
                </select>
                <span style={{ display: 'block', marginTop: 4, fontSize: '0.75rem', color: '#71717a' }}>
                  Archimedean Chords creates a distinct center spiral lip that tactilely reveals over/under-extrusion.
                </span>
              </div>

              {/* Replacement confirmation alert */}
              {showConfirmReplace && (
                <div
                  data-testid="calib-confirm-banner"
                  style={{
                    margin: '16px 0',
                    padding: '12px 14px',
                    background: 'rgba(234, 179, 8, 0.15)',
                    border: '1px solid #eab308',
                    borderRadius: 6,
                    color: '#fef08a'
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Replace current plate?</div>
                  <div style={{ fontSize: '0.82rem', marginBottom: 10, color: '#fde047' }}>
                    Objects are currently loaded on the build plate. Generating calibration will replace the plate with test chips.
                    You can restore your current project at any time using Undo (Ctrl+Z).
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      id="calib-confirm-proceed"
                      data-testid="calib-confirm-proceed"
                      className="btn btn-primary"
                      onClick={confirmReplaceAndStart}
                      disabled={isCalibrating}
                    >
                      Proceed
                    </button>
                    <button
                      type="button"
                      id="calib-confirm-cancel"
                      data-testid="calib-confirm-cancel"
                      className="btn btn-secondary"
                      onClick={cancelConfirmReplace}
                      disabled={isCalibrating}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              {!showConfirmReplace && (
                <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={closeDialog}
                    disabled={isCalibrating}
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    id="calib-generate-btn"
                    data-testid="calib-generate-btn"
                    className="btn btn-primary"
                    onClick={startCalibration}
                    disabled={isCalibrating}
                  >
                    {isCalibrating ? 'Loading...' : 'Generate Calibration Plate'}
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'calculator' && (
            <div>
              <p style={{ fontSize: '0.85rem', color: '#a1a1aa', marginBottom: 16 }}>
                Print the calibration plate and inspect the top surface of the chips with your finger.
                Select the chip with the smoothest surface without gaps or rough over-extrusion ridges.
              </p>

              {/* Current flow ratio */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#e4e4e7', marginBottom: 4 }}>
                  Current Flow Ratio:
                </label>
                <input
                  type="number"
                  step="0.01"
                  id="calib-calc-current" data-testid="calib-calc-current"
                  value={customOldFlow}
                  onChange={(e) => setCustomOldFlow(e.target.value === '' ? '' : parseFloat(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    background: '#18181b',
                    color: '#e4e4e7',
                    border: '1px solid #3f3f46',
                    borderRadius: 4
                  }}
                />
              </div>

              {/* Modifier input */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#e4e4e7', marginBottom: 4 }}>
                  Selected Chip Modifier (%):
                </label>
                <input
                  type="number"
                  id="calib-calc-modifier"
                  data-testid="calib-calc-modifier"
                  placeholder="e.g. 5, -5, 0, -10"
                  value={calculatorModifier}
                  onChange={(e) => setCalculatorModifier(e.target.value === '' ? '' : parseFloat(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    background: '#18181b',
                    color: '#e4e4e7',
                    border: '1px solid #3f3f46',
                    borderRadius: 4
                  }}
                />
                <span style={{ fontSize: '0.75rem', color: '#71717a' }}>
                  Enter the chip label number (e.g. 5 for +5%, -10 for -10%).
                </span>
              </div>

              {/* Calculated Result Card */}
              <div
                style={{
                  margin: '16px 0',
                  padding: '12px 14px',
                  background: '#18181b',
                  border: '1px solid #3f3f46',
                  borderRadius: 6
                }}
              >
                <div style={{ fontSize: '0.8rem', color: '#a1a1aa', marginBottom: 4 }}>
                  Formula: <code style={{ color: '#38bdf8' }}>New Flow = Old Flow × (100 + Modifier) / 100</code>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: '0.9rem', color: '#e4e4e7' }}>New Flow Ratio:</span>
                  <span
                    id="calib-calc-result"
                    data-testid="calib-calc-result"
                    style={{
                      fontSize: '1.25rem',
                      fontWeight: 700,
                      color: calculatedNewFlow !== null ? '#34d399' : '#71717a'
                    }}
                  >
                    {calculatedNewFlow !== null ? calculatedNewFlow.toFixed(4) : '--'}
                  </span>
                </div>
              </div>

              {calculatorMessage && (
                <div
                  data-testid="calib-calc-message"
                  style={{
                    marginBottom: 12,
                    padding: '8px 12px',
                    background: 'rgba(52, 211, 153, 0.15)',
                    border: '1px solid #34d399',
                    borderRadius: 4,
                    color: '#a7f3d0',
                    fontSize: '0.85rem'
                  }}
                >
                  {calculatorMessage}
                </div>
              )}

              {/* Apply Button */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={closeDialog}
                >
                  Close
                </button>
                <button
                  type="button"
                  id="calib-calc-apply"
                  data-testid="calib-calc-apply"
                  className="btn btn-primary"
                  onClick={applyCalculatedFlow}
                  disabled={calculatedNewFlow === null}
                >
                  Apply Flow Ratio
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </ModalBackdrop>
  );
};
