import React from 'react';
import { useCalibrationStore } from '../calibration/calibrationStore';
import { useInputShapingStore } from '../calibration/inputShapingStore';
import { useOtherCalibrationStore } from '../calibration/otherCalibrationStore';

interface Tile { id: string; label: string; hint: string; testId?: string; onClick: () => void }

/** Desktop's Calibration tab: one tile per calibration, each opening its dialog. */
export const CalibrationPage: React.FC = () => {
  const openOther = useOtherCalibrationStore((s) => s.openDialog);
  const openShaping = useInputShapingStore((s) => s.openDialog);

  const groups: Array<{ title: string; tiles: Tile[] }> = [
    { title: 'Extrusion', tiles: [
      { id: 'calibration-btn', testId: 'calibration-btn', label: 'Flow rate', hint: 'Find the flow ratio, coarse then fine', onClick: () => useCalibrationStore.getState().openDialog() },
      { id: 'cal-pa-line', label: 'Pressure advance (line)', hint: 'Lines at rising K values', onClick: () => openOther('pa_line') },
      { id: 'cal-pa-pattern', label: 'Pressure advance (pattern)', hint: 'Corner pattern at rising K values', onClick: () => openOther('pa_pattern') },
      { id: 'cal-pa-tower', label: 'Pressure advance (tower)', hint: 'Tower with K rising along Z', onClick: () => openOther('pa_tower') },
      { id: 'cal-retraction', label: 'Retraction', hint: 'Tower with retraction length rising along Z', onClick: () => openOther('retraction') },
      { id: 'cal-maxvol', label: 'Max volumetric speed', hint: 'Find the filament flow limit', onClick: () => openOther('max_vol') }
    ] },
    { title: 'Temperature and quality', tiles: [
      { id: 'cal-temp', label: 'Temperature', hint: 'Tower with the nozzle temperature falling along Z', onClick: () => openOther('temp') },
      { id: 'cal-vfa', label: 'VFA', hint: 'Vertical fine artifacts across speeds', onClick: () => openOther('vfa') }
    ] },
    { title: 'Motion', tiles: [
      { id: 'cal-shaping-freq', label: 'Input shaping frequency', hint: 'Ringing tower across frequencies', onClick: () => openShaping('freq') },
      { id: 'cal-shaping-damp', label: 'Input shaping damping', hint: 'Ringing tower across damping ratios', onClick: () => openShaping('damp') },
      { id: 'cal-cornering', label: 'Cornering', hint: 'Junction deviation or square corner velocity', onClick: () => openShaping('cornering') }
    ] }
  ];

  return (
    <div className="calibration-page" id="calibration-page">
      <h2>Calibration</h2>
      <p className="lead">Each test replaces the plate with a calibration model and sets up the matching slicer settings. Undo brings your project back.</p>
      {groups.map((g) => (
        <div className="calib-group" key={g.title}>
          <h3>{g.title}</h3>
          <div className="calib-tiles">
            {g.tiles.map((t) => (
              <button key={t.id} id={t.id} data-testid={t.testId} className="calib-tile" onClick={t.onClick}>
                <strong>{t.label}</strong><span>{t.hint}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
