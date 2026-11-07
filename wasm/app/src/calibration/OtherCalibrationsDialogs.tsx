import { InputShapingDialogs } from './InputShapingDialogs';
import { useState, useEffect } from 'react';
import { CalibrationDialogWrapper as DialogWrapper, useCalibrationError } from './CalibrationDialogWrapper';
import { useOtherCalibrationStore } from './otherCalibrationStore';
import { runOtherCalibration } from './calibrationUtils';
import { useTranslation } from "../i18n";

const vfaDrc = '/resources/calib/vfa/vfa.drc';
const tempTowerDrc = '/resources/calib/temperature_tower/temperature_tower.drc';
const speedTestDrc = '/resources/calib/volumetric_speed/SpeedTestStructure.drc';
const retractionDrc = '/resources/calib/retraction/retraction_tower.drc';
const paTestDrc = '/resources/calib/pressure_advance/pressure_advance_test.drc';
const paTowerDrc = '/resources/calib/pressure_advance/tower_with_seam.drc';

function PACalibrationDialog({ onClose, initialMode }: { onClose: () => void, initialMode: 'line' | 'pattern' | 'tower' }) {
    const { t } = useTranslation();
  const [mode, setMode] = useState(initialMode);
  const [extruder, setExtruder] = useState('dde');
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(initialMode === 'pattern' ? 0.08 : 0.1);
  const [step, setStep] = useState(initialMode === 'pattern' ? 0.005 : 0.002);
  const [printNumbers, setPrintNumbers] = useState(true);
  const [accelerations, setAccelerations] = useState('');
  const [speeds, setSpeeds] = useState('');
  
  const { error, errorId, setError, clearError, field } = useCalibrationError();
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let newEnd = extruder === 'dde' ? 0.1 : 1.0;
    let newStep = extruder === 'dde' ? 0.002 : 0.02;
    
    if (mode === 'pattern') {
      newEnd = extruder === 'dde' ? 0.08 : 1.0;
      newStep = extruder === 'dde' ? 0.005 : 0.05;
    }
    
    setEnd(newEnd);
    setStep(newStep);
    setPrintNumbers(mode !== 'tower');
  }, [mode, extruder]);

  const handleOk = async () => {
    const invalid = [
      !Number.isFinite(start) || start < 0 ? 'start' : '',
      !Number.isFinite(step) || step < 10 * Number.EPSILON ? 'step' : '',
      !Number.isFinite(end) || end < start + step ? 'end' : ''
    ].filter(Boolean);
    if (invalid.length) {
      return setError('Please input valid values:\n(0 <= Start < End), Step > 0', invalid);
    }

    setError(null);
    setIsLoading(true);
    
    try {
      const meshes: Record<string, string> = {};
      let backendMode = 1;
      
      if (mode === 'line') {
        backendMode = 1; // Calib_PA_Line
        meshes['pressure_advance_test.drc'] = paTestDrc;
      } else if (mode === 'pattern') {
        backendMode = 2; // Calib_PA_Pattern
      } else if (mode === 'tower') {
        backendMode = 3; // Calib_PA_Tower
        meshes['tower_with_seam.drc'] = paTowerDrc;
      }
      
      const accels = accelerations ? accelerations.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n)) : undefined;
      const spds = speeds ? speeds.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n)) : undefined;

      const options: any = {
        mode: backendMode,
        extruder_id: 0,
        start, end, step,
        print_numbers: printNumbers
      };
      
      if (mode === 'pattern') {
        if (accels && accels.length > 0) options.accelerations = accels;
        if (spds && spds.length > 0) options.speeds = spds;
      }

      await runOtherCalibration('PA Calibration', options, meshes);
      onClose();
    } catch (err: any) {
      console.error("[Dialog Error]:", err); setError(err.message || String(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <DialogWrapper title={t("PA Calibration")} onClose={onClose} onOk={handleOk} error={error} errorId={errorId} onEdit={clearError} isLoading={isLoading}>
      <div className="field-row">
        <label>{t("Method:")}<select value={mode} onChange={(e) => setMode(e.target.value as any)}>
          <option value="line">{t("Line")}</option>
          <option value="pattern">{t("Pattern")}</option>
          <option value="tower">{t("Tower")}</option>
        </select></label>
      </div>
      <div className="field-row">
        <label>{t("Extruder Type:")}<select value={extruder} onChange={(e) => setExtruder(e.target.value)}>
          <option value="dde">{t("DDE")}</option>
          <option value="bowden">{t("Bowden")}</option>
        </select></label>
      </div>
      <div className="field-row">
        <label>{t("Start PA:")}<input {...field('start')} aria-label={t("Start PA")} type="number" step="0.001" value={start} onChange={(e) => setStart(parseFloat(e.target.value))} /></label>
      </div>
      <div className="field-row">
        <label>{t("End PA:")}<input {...field('end')} aria-label={t("End PA")} type="number" step="0.001" value={end} onChange={(e) => setEnd(parseFloat(e.target.value))} /></label>
      </div>
      <div className="field-row">
        <label>{t("PA step:")}<input {...field('step')} aria-label={t("PA step")} type="number" step="0.001" value={step} onChange={(e) => setStep(parseFloat(e.target.value))} /></label>
      </div>
      <div className="field-row">
        <label>{t("Print numbers:")}<input type="checkbox" checked={printNumbers} disabled={mode === 'tower'} onChange={(e) => setPrintNumbers(e.target.checked)} /></label>
      </div>
      {mode === 'pattern' && (
        <>
          <div className="field-row">
            <label>{t("Accelerations:")}<input aria-label={t("Accelerations")} type="text" value={accelerations} onChange={(e) => setAccelerations(e.target.value)} /></label>
          </div>
          <div className="field-row">
            <label>{t("Speeds:")}<input aria-label={t("Speeds")} type="text" value={speeds} onChange={(e) => setSpeeds(e.target.value)} /></label>
          </div>
        </>
      )}
    </DialogWrapper>
  );
}

function TempTowerDialog({ onClose }: { onClose: () => void }) {
    const { t } = useTranslation();
  const [start, setStart] = useState(230);
  const [end, setEnd] = useState(190);
  const step = 5;
  const { error, errorId, setError, clearError, field } = useCalibrationError();
  const [isLoading, setIsLoading] = useState(false);

  const handleOk = async () => {
    if (!Number.isFinite(start) || start > 500) return setError('Start must be <= 500', ['start']);
    if (!Number.isFinite(end) || end < 155) return setError('End must be >= 155', ['end']);
    if (start < end + 5) return setError('Start must be >= End + 5', ['start', 'end']);

    setError(null);
    setIsLoading(true);
    
    try {
      await runOtherCalibration('Temperature Tower', {
        mode: 6, // Calib_Temp_Tower
        start, end, step,
        extruder_id: 0,
        nozzle_based_resize: true
      }, {
        'temperature_tower.drc': tempTowerDrc
      });
      onClose();
    } catch (err: any) {
      console.error("[Dialog Error]:", err); setError(err.message || String(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <DialogWrapper title={t("Temperature Tower")} onClose={onClose} onOk={handleOk} error={error} errorId={errorId} onEdit={clearError} isLoading={isLoading}>
      <div className="field-row">
        <label>{t("Start Temperature:")}<input {...field('start', 'temp-start-unit')} aria-label={t("Start Temperature")} type="number" value={start} onChange={(e) => setStart(parseFloat(e.target.value))} /><span id="temp-start-unit" className="calibration-unit">°C</span></label>
      </div>
      <div className="field-row">
        <label>{t("End Temperature:")}<input {...field('end', 'temp-end-unit')} aria-label={t("End Temperature")} type="number" value={end} onChange={(e) => setEnd(parseFloat(e.target.value))} /><span id="temp-end-unit" className="calibration-unit">°C</span></label>
      </div>
      <div className="field-row">
        <label>{t("Step:")}<input {...field('step', 'temp-step-unit')} aria-label={t("Step")} type="number" value={step} disabled /><span id="temp-step-unit" className="calibration-unit">°C</span></label>
      </div>
    </DialogWrapper>
  );
}

function VFADialog({ onClose }: { onClose: () => void }) {
    const { t } = useTranslation();
  const [start, setStart] = useState(40);
  const [end, setEnd] = useState(200);
  const [step, setStep] = useState(10);
  const { error, errorId, setError, clearError, field } = useCalibrationError();
  const [isLoading, setIsLoading] = useState(false);

  const handleOk = async () => {
    const invalid = [
      !Number.isFinite(start) || start < 0 ? 'start' : '',
      !Number.isFinite(step) || step <= 0 ? 'step' : '',
      !Number.isFinite(end) || end < start + step ? 'end' : ''
    ].filter(Boolean);
    if (invalid.length) return setError('Invalid values', invalid);

    setError(null);
    setIsLoading(true);
    
    try {
      await runOtherCalibration('VFA', {
        mode: 8, // Calib_VFA_Tower
        start, end, step,
        extruder_id: 0,
        nozzle_based_resize: true,
        vfa_layer_height: 0
      }, {
        'vfa.drc': vfaDrc
      });
      onClose();
    } catch (err: any) {
      console.error("[Dialog Error]:", err); setError(err.message || String(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <DialogWrapper title={t("VFA")} onClose={onClose} onOk={handleOk} error={error} errorId={errorId} onEdit={clearError} isLoading={isLoading}>
      <div className="field-row">
        <label>{t("Start Speed:")}<input {...field('start', 'vfa-start-unit')} aria-label={t("Start Speed")} type="number" value={start} onChange={(e) => setStart(parseFloat(e.target.value))} /><span id="vfa-start-unit" className="calibration-unit">mm/s</span></label>
      </div>
      <div className="field-row">
        <label>{t("End Speed:")}<input {...field('end', 'vfa-end-unit')} aria-label={t("End Speed")} type="number" value={end} onChange={(e) => setEnd(parseFloat(e.target.value))} /><span id="vfa-end-unit" className="calibration-unit">mm/s</span></label>
      </div>
      <div className="field-row">
        <label>{t("Step:")}<input {...field('step', 'vfa-step-unit')} aria-label={t("Step")} type="number" value={step} onChange={(e) => setStep(parseFloat(e.target.value))} /><span id="vfa-step-unit" className="calibration-unit">mm/s</span></label>
      </div>
    </DialogWrapper>
  );
}

function GenericCalibrationDialog({ 
  title, mode, defaultStart, defaultEnd, defaultStep, 
  validate, unit, drcFile, drcUrl, onClose
}: any) {
    const { t } = useTranslation();
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);
  const [step, setStep] = useState(defaultStep);
  const { error, errorId, setError, clearError, field } = useCalibrationError();
  const [isLoading, setIsLoading] = useState(false);

  const handleOk = async () => {
    const err = validate(start, end, step);
    if (err) return setError(err.message, [err.field]);

    setError(null);
    setIsLoading(true);
    
    try {
      await runOtherCalibration(title, {
        mode,
        start, end, step,
        extruder_id: 0
      }, {
        [drcFile]: drcUrl
      });
      onClose();
    } catch (err: any) {
      console.error("[Dialog Error]:", err); setError(err.message || String(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <DialogWrapper title={title} onClose={onClose} onOk={handleOk} error={error} errorId={errorId} onEdit={clearError} isLoading={isLoading}>
      <div className="field-row">
        <label>{t("Start:")}<input {...field('start', 'cal-start-unit')} aria-label={t("Start")} type="number" step="0.1" value={start} onChange={(e) => setStart(parseFloat(e.target.value))} /><span id="cal-start-unit" className="calibration-unit">{unit}</span></label>
      </div>
      <div className="field-row">
        <label>{t("End:")}<input {...field('end', 'cal-end-unit')} aria-label={t("End")} type="number" step="0.1" value={end} onChange={(e) => setEnd(parseFloat(e.target.value))} /><span id="cal-end-unit" className="calibration-unit">{unit}</span></label>
      </div>
      <div className="field-row">
        <label>{t("Step:")}<input {...field('step', 'cal-step-unit')} aria-label={t("Step")} type="number" step="0.1" value={step} onChange={(e) => setStep(parseFloat(e.target.value))} /><span id="cal-step-unit" className="calibration-unit">{unit}</span></label>
      </div>
    </DialogWrapper>
  );
}

function OtherCalibrationsDialogsInner() {
    const { t } = useTranslation();
  const { activeCalibration, closeDialog } = useOtherCalibrationStore();

  if (!activeCalibration) return null;

  switch (activeCalibration) {
    case 'pa_line':
      return <PACalibrationDialog onClose={closeDialog} initialMode="line" />;
    case 'pa_pattern':
      return <PACalibrationDialog onClose={closeDialog} initialMode="pattern" />;
    case 'pa_tower':
      return <PACalibrationDialog onClose={closeDialog} initialMode="tower" />;
    case 'temp':
      return <TempTowerDialog onClose={closeDialog} />;
    case 'max_vol':
      return (
        <GenericCalibrationDialog
          title={t("Max Volumetric Speed")}
          mode={7} // Calib_Vol_speed_Tower
          unit="mm³/s"
          defaultStart={5}
          defaultEnd={20}
          defaultStep={0.5}
          validate={(s: number, e: number, st: number) => {
            if (!Number.isFinite(s) || s <= 0) return { message: 'Start must be > 0', field: 'start' };
            if (!Number.isFinite(st) || st <= 0) return { message: 'Step must be > 0', field: 'step' };
            if (!Number.isFinite(e) || e < s + st) return { message: 'End must be >= Start + Step', field: 'end' };
            return null;
          }}
          drcFile="SpeedTestStructure.drc"
          drcUrl={speedTestDrc}
          onClose={closeDialog}
        />
      );
    case 'vfa':
      return <VFADialog onClose={closeDialog} />;
    case 'retraction':
      return (
        <GenericCalibrationDialog
          title={t("Retraction")}
          mode={9} // Calib_Retraction_tower
          unit="mm"
          defaultStart={0}
          defaultEnd={2}
          defaultStep={0.1}
          validate={(s: number, e: number, st: number) => {
            if (!Number.isFinite(s) || s < 0) return { message: 'Start must be >= 0', field: 'start' };
            if (!Number.isFinite(st) || st <= 0) return { message: 'Step must be > 0', field: 'step' };
            if (!Number.isFinite(e) || e < s + st) return { message: 'End must be >= Start + Step', field: 'end' };
            return null;
          }}
          drcFile="retraction_tower.drc"
          drcUrl={retractionDrc}
          onClose={closeDialog}
        />
      );
    default:
      return null;
  }
}


export function OtherCalibrationsDialogs() {
    const { t } = useTranslation();
  return (
    <>
      <OtherCalibrationsDialogsInner />
      <InputShapingDialogs />
    </>
  );
}
