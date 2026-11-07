import React from 'react';
import { useCalibrationStore } from '../calibration/calibrationStore';
import { useInputShapingStore } from '../calibration/inputShapingStore';
import { useOtherCalibrationStore } from '../calibration/otherCalibrationStore';
import { useTranslation } from "../i18n";

interface Tile { id: string; label: string; hint: string; testId?: string; onClick: () => void }

/** Desktop's Calibration tab: one tile per calibration, each opening its dialog. */
export const CalibrationPage: React.FC = () => {
    const { t } = useTranslation();
  const openOther = useOtherCalibrationStore((s) => s.openDialog);
  const openShaping = useInputShapingStore((s) => s.openDialog);

  const groups: Array<{ title: string; tiles: Tile[] }> = [
    { title: t("Extrusion"), tiles: [
      { id: 'calibration-btn', testId: 'calibration-btn', label: t("Flow rate"), hint: 'Gaps or ridges on top surfaces → tune flow ratio, coarse then fine', onClick: () => useCalibrationStore.getState().openDialog() },
      { id: 'cal-pa-line', label: t("Pressure advance (line)"), hint: 'Uneven line width → quick first-layer comparison at rising K values', onClick: () => openOther('pa_line') },
      { id: 'cal-pa-pattern', label: t("Pressure advance (pattern)"), hint: 'Bulging corners → corner tuning at rising K values', onClick: () => openOther('pa_pattern') },
      { id: 'cal-pa-tower', label: t("Pressure advance (tower)"), hint: 'Compare corner quality along Z as K rises', onClick: () => openOther('pa_tower') },
      { id: 'cal-retraction', label: t("Retraction"), hint: 'Stringing → compare retraction lengths along Z', onClick: () => openOther('retraction') },
      { id: 'cal-maxvol', label: t("Max volumetric speed"), hint: 'Find the filament flow limit', onClick: () => openOther('max_vol') }
    ] },
    { title: t("Temperature and quality"), tiles: [
      { id: 'cal-temp', label: t("Temperature"), hint: 'Tower with the nozzle temperature falling along Z', onClick: () => openOther('temp') },
      { id: 'cal-vfa', label: t("VFA"), hint: 'Vertical fine artifacts across speeds', onClick: () => openOther('vfa') }
    ] },
    { title: t("Motion"), tiles: [
      { id: 'cal-shaping-freq', label: t("Input shaping frequency"), hint: 'Ringing tower across frequencies', onClick: () => openShaping('freq') },
      { id: 'cal-shaping-damp', label: t("Input shaping damping"), hint: 'Ringing tower across damping ratios', onClick: () => openShaping('damp') },
      { id: 'cal-cornering', label: t("Cornering"), hint: 'Junction deviation or square corner velocity', onClick: () => openShaping('cornering') }
    ] }
  ];

  return (
    <div className="calibration-page" id="calibration-page">
      <h2>{t("Calibration")}</h2>
      <p className="lead">{t("Each test replaces the plate with a calibration model and sets up the matching slicer settings. Undo brings your project back.")}</p>
      <p className="calibration-prerequisites">{t('Before testing: select your printer, nozzle and filament; use a clean, level bed. Tune temperature and flow before pressure advance. Pressure advance and motion tests require compatible firmware. Choose any test below to open its settings.')}</p>
      {groups.map((g) => (
        <div className="calib-group" key={g.title}>
          <h3>{g.title}</h3>
          <div className="calib-tiles">
            {g.tiles.map((tile) => (
              <button key={tile.id} id={tile.id} data-testid={tile.testId} className="calib-tile" onClick={tile.onClick}>
                <strong>{tile.label}</strong><span>{t(tile.hint)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
