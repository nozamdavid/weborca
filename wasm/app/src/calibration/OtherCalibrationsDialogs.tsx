import { InputShapingDialogs } from './InputShapingDialogs';
import { useState, useEffect } from 'react';
import { CalibrationDialogWrapper as DialogWrapper } from './CalibrationDialogWrapper';
import { useOtherCalibrationStore } from './otherCalibrationStore';
import { runOtherCalibration } from './calibrationUtils';


const vfaDrc = '/resources/calib/vfa/vfa.drc';
const tempTowerDrc = '/resources/calib/temperature_tower/temperature_tower.drc';
const speedTestDrc = '/resources/calib/volumetric_speed/SpeedTestStructure.drc';
const retractionDrc = '/resources/calib/retraction/retraction_tower.drc';
const paTestDrc = '/resources/calib/pressure_advance/pressure_advance_test.drc';
const paTowerDrc = '/resources/calib/pressure_advance/tower_with_seam.drc';

function PACalibrationDialog({ onClose, initialMode }: { onClose: () => void, initialMode: 'line' | 'pattern' | 'tower' }) {
  const [mode, setMode] = useState(initialMode);
  const [extruder, setExtruder] = useState('dde');
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(initialMode === 'pattern' ? 0.08 : 0.1);
  const [step, setStep] = useState(initialMode === 'pattern' ? 0.005 : 0.002);
  const [printNumbers, setPrintNumbers] = useState(true);
  const [accelerations, setAccelerations] = useState('');
  const [speeds, setSpeeds] = useState('');
  
  const [error, setError] = useState<string | null>(null);
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
    if (start < 0 || step < 10 * Number.EPSILON || end < start + step) {
      return setError('Please input valid values:\n(0 <= Start < End), Step > 0');
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
    <DialogWrapper title="PA Calibration" onClose={onClose} onOk={handleOk} error={error} isLoading={isLoading}>
      <div className="field-row">
        <label>Method: <select value={mode} onChange={(e) => setMode(e.target.value as any)}>
          <option value="line">Line</option>
          <option value="pattern">Pattern</option>
          <option value="tower">Tower</option>
        </select></label>
      </div>
      <div className="field-row">
        <label>Extruder Type: <select value={extruder} onChange={(e) => setExtruder(e.target.value)}>
          <option value="dde">DDE</option>
          <option value="bowden">Bowden</option>
        </select></label>
      </div>
      <div className="field-row">
        <label>Start PA: <input aria-label="Start PA" type="number" step="0.001" value={start} onChange={(e) => setStart(parseFloat(e.target.value))} /></label>
      </div>
      <div className="field-row">
        <label>End PA: <input aria-label="End PA" type="number" step="0.001" value={end} onChange={(e) => setEnd(parseFloat(e.target.value))} /></label>
      </div>
      <div className="field-row">
        <label>PA step: <input aria-label="PA step" type="number" step="0.001" value={step} onChange={(e) => setStep(parseFloat(e.target.value))} /></label>
      </div>
      <div className="field-row">
        <label>Print numbers: <input type="checkbox" checked={printNumbers} disabled={mode === 'tower'} onChange={(e) => setPrintNumbers(e.target.checked)} /></label>
      </div>
      {mode === 'pattern' && (
        <>
          <div className="field-row">
            <label>Accelerations: <input aria-label="Accelerations" type="text" value={accelerations} onChange={(e) => setAccelerations(e.target.value)} /></label>
          </div>
          <div className="field-row">
            <label>Speeds: <input aria-label="Speeds" type="text" value={speeds} onChange={(e) => setSpeeds(e.target.value)} /></label>
          </div>
        </>
      )}
    </DialogWrapper>
  );
}

function TempTowerDialog({ onClose }: { onClose: () => void }) {
  const [start, setStart] = useState(230);
  const [end, setEnd] = useState(190);
  const step = 5;
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleOk = async () => {
    if (start > 500) return setError('Start must be <= 500');
    if (end < 155) return setError('End must be >= 155');
    if (start < end + 5) return setError('Start must be >= End + 5');

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
    <DialogWrapper title="Temperature Tower" onClose={onClose} onOk={handleOk} error={error} isLoading={isLoading}>
      <div className="field-row">
        <label>Start Temperature: <input aria-label="Start Temperature" type="number" value={start} onChange={(e) => setStart(parseFloat(e.target.value))} /></label>
      </div>
      <div className="field-row">
        <label>End Temperature: <input aria-label="End Temperature" type="number" value={end} onChange={(e) => setEnd(parseFloat(e.target.value))} /></label>
      </div>
      <div className="field-row">
        <label>Step: <input aria-label="Step" type="number" value={step} disabled /></label>
      </div>
    </DialogWrapper>
  );
}

function VFADialog({ onClose }: { onClose: () => void }) {
  const [start, setStart] = useState(40);
  const [end, setEnd] = useState(200);
  const [step, setStep] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleOk = async () => {
    if (start < 0 || step <= 0 || end < start + step) return setError('Invalid values');

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
    <DialogWrapper title="VFA" onClose={onClose} onOk={handleOk} error={error} isLoading={isLoading}>
      <div className="field-row">
        <label>Start Speed: <input aria-label="Start Speed" type="number" value={start} onChange={(e) => setStart(parseFloat(e.target.value))} /></label>
      </div>
      <div className="field-row">
        <label>End Speed: <input aria-label="End Speed" type="number" value={end} onChange={(e) => setEnd(parseFloat(e.target.value))} /></label>
      </div>
      <div className="field-row">
        <label>Step: <input aria-label="Step" type="number" value={step} onChange={(e) => setStep(parseFloat(e.target.value))} /></label>
      </div>
    </DialogWrapper>
  );
}

function GenericCalibrationDialog({ 
  title, mode, defaultStart, defaultEnd, defaultStep, 
  validate, drcFile, drcUrl, onClose 
}: any) {
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);
  const [step, setStep] = useState(defaultStep);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleOk = async () => {
    const err = validate(start, end, step);
    if (err) return setError(err);

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
    <DialogWrapper title={title} onClose={onClose} onOk={handleOk} error={error} isLoading={isLoading}>
      <div className="field-row">
        <label>Start: <input aria-label="Start" type="number" step="0.1" value={start} onChange={(e) => setStart(parseFloat(e.target.value))} /></label>
      </div>
      <div className="field-row">
        <label>End: <input aria-label="End" type="number" step="0.1" value={end} onChange={(e) => setEnd(parseFloat(e.target.value))} /></label>
      </div>
      <div className="field-row">
        <label>Step: <input aria-label="Step" type="number" step="0.1" value={step} onChange={(e) => setStep(parseFloat(e.target.value))} /></label>
      </div>
    </DialogWrapper>
  );
}

function OtherCalibrationsDialogsInner() {
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
          title="Max Volumetric Speed"
          mode={7} // Calib_Vol_speed_Tower
          defaultStart={5}
          defaultEnd={20}
          defaultStep={0.5}
          validate={(s: number, e: number, st: number) => {
            if (s <= 0) return 'Start must be > 0';
            if (st <= 0) return 'Step must be > 0';
            if (e < s + st) return 'End must be >= Start + Step';
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
          title="Retraction"
          mode={9} // Calib_Retraction_tower
          defaultStart={0}
          defaultEnd={2}
          defaultStep={0.1}
          validate={(s: number, e: number, st: number) => {
            if (s < 0) return 'Start must be >= 0';
            if (st <= 0) return 'Step must be > 0';
            if (e < s + st) return 'End must be >= Start + Step';
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
  return (
    <>
      <OtherCalibrationsDialogsInner />
      <InputShapingDialogs />
    </>
  );
}
