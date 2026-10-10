import { useState } from 'react';
import { useAppStore } from '../store/appStore';
import { CalibrationDialogWrapper } from './CalibrationDialogWrapper';
import { runOtherCalibration } from './calibrationUtils';
import { useInputShapingStore } from './inputShapingStore';

/**
 * The input shaping frequency, damping and cornering tests. Fields, defaults, ranges and messages follow
 * desktop's Input_Shaping_Freq_Test_Dlg, Input_Shaping_Damp_Test_Dlg and Cornering_Test_Dlg (calib_dlg.cpp).
 */

const CALIB_MODE = { freq: 10, damp: 11, cornering: 12 } as const;

const MODELS = [
  { label: 'Ringing Tower', drc: 'ringing_tower.drc', url: '/resources/calib/input_shaping/ringing_tower.drc' },
  { label: 'Fast Tower', drc: 'fast_tower_test.drc', url: '/resources/calib/input_shaping/fast_tower_test.drc' },
  { label: 'SCV-V2', drc: 'SCV-V2.drc', url: '/resources/calib/cornering/SCV-V2.drc' }
];

/** Shaper types per firmware, as desktop's input_shaper_types_for_flavor (without "Disable"). */
const SHAPER_TYPES: Record<string, string[]> = {
  klipper: ['Default', 'ZV', 'MZV', 'ZVD', 'EI', '2HUMP_EI', '3HUMP_EI'],
  reprapfirmware: ['Default', 'MZV', 'ZVD', 'ZVDD', 'ZVDDD', 'EI2', 'EI3', 'DAA'],
  marlin2: ['ZV']
};

const FIRMWARE_NOTE: Record<string, string> = {
  marlin: 'Marlin version => 2.1.2\nFixed-Time motion not yet implemented.',
  marlin2: 'Marlin version => 2.1.2\nFixed-Time motion not yet implemented.',
  klipper: 'Klipper version => 0.9.0',
  reprapfirmware: 'RepRap firmware version => 3.4.0\nCheck your firmware documentation for supported shaper types.'
};

function useFirmware() {
  const config = useAppStore((s) => s.currentConfig);
  const flavor = config.gcode_flavor ?? '';
  const junctionDeviation = flavor === 'marlin2' && parseFloat((config.machine_max_junction_deviation ?? '').split(',')[0]) > 0;
  return {
    flavor,
    reprap: flavor === 'reprapfirmware',
    shaperTypes: SHAPER_TYPES[flavor] ?? ['Default'],
    note: FIRMWARE_NOTE[flavor] ?? 'Please ensure the selected type is compatible with your firmware version.',
    junctionDeviation
  };
}

const Radios = ({ label, options, value, onChange }: { label: string; options: string[]; value: number; onChange: (i: number) => void }) => (
  <fieldset className="form-group" role="radiogroup" aria-label={label}>
    <legend>{label}</legend>
    {options.map((option, i) => (
      <label key={option} style={{ display: 'block' }}>
        <input type="radio" name={label} checked={value === i} onChange={() => onChange(i)} /> {option}
      </label>
    ))}
  </fieldset>
);

const Field = ({ label, unit, value, onChange, disabled }: { label: string; unit?: string; value: string; onChange: (v: string) => void; disabled?: boolean }) => (
  <div className="field-row">
    <label>{label}: <input aria-label={label} type="number" step="any" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} /> {unit}</label>
  </div>
);

const Note = ({ children }: { children: string }) => <p style={{ color: '#888', whiteSpace: 'pre-line', fontSize: 12 }}>{children}</p>;

function FrequencyDialog({ onClose }: { onClose: () => void }) {
  const fw = useFirmware();
  const [model, setModel] = useState(0);
  const [type, setType] = useState(0);
  const [startX, setStartX] = useState('15');
  const [endX, setEndX] = useState('110');
  const [startY, setStartY] = useState('15');
  const [endY, setEndY] = useState('110');
  const [damping, setDamping] = useState('0.150');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    const [sx, ex, damp] = [startX, endX, damping].map(Number);
    const sy = fw.reprap ? sx : Number(startY);
    const ey = fw.reprap ? ex : Number(endY);
    if ([sx, ex, sy, ey].some((v) => !Number.isFinite(v)) || sx < 0 || ex > 500 || sy < 0 || ey > 500 || sx >= ex || sy >= ey) {
      return setError('Please input valid values:\n(0 < FreqStart < FreqEnd < 500)');
    }
    if (!Number.isFinite(damp) || damp < 0 || damp >= 1) {
      return setError('Please input a valid damping factor (0 < Damping/zeta factor <= 1)');
    }
    setError(null);
    setLoading(true);
    try {
      const m = MODELS[model];
      await runOtherCalibration('Input shaping frequency', {
        mode: CALIB_MODE.freq, start: damp, test_model: model, freqStartX: sx, freqEndX: ex, freqStartY: sy, freqEndY: ey, shaper_type: fw.shaperTypes[type]
      }, { [m.drc]: m.url });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <CalibrationDialogWrapper title="Input shaping Frequency test" onClose={onClose} onOk={run} error={error} isLoading={loading}>
      <Radios label="Test model" options={MODELS.slice(0, 2).map((m) => m.label)} value={model} onChange={setModel} />
      <Radios label="Input shaper type" options={fw.shaperTypes} value={type} onChange={setType} />
      <Note>{fw.note}</Note>
      {fw.reprap ? (
        <>
          <Field label="Frequency start" unit="Hz" value={startX} onChange={setStartX} />
          <Field label="Frequency end" unit="Hz" value={endX} onChange={setEndX} />
        </>
      ) : (
        <>
          <Field label="X start" unit="Hz" value={startX} onChange={setStartX} />
          <Field label="X end" unit="Hz" value={endX} onChange={setEndX} />
          <Field label="Y start" unit="Hz" value={startY} onChange={setStartY} />
          <Field label="Y end" unit="Hz" value={endY} onChange={setEndY} />
        </>
      )}
      <Field label="Damp" value={damping} onChange={setDamping} />
      <Note>{'Recommended: Set Damp to 0.\nThis will use the printer\'s default or saved value.'}</Note>
    </CalibrationDialogWrapper>
  );
}

function DampingDialog({ onClose }: { onClose: () => void }) {
  const fw = useFirmware();
  const [model, setModel] = useState(0);
  const [type, setType] = useState(0);
  const [freqX, setFreqX] = useState('30');
  const [freqY, setFreqY] = useState('30');
  const [dampStart, setDampStart] = useState('0.000');
  const [dampEnd, setDampEnd] = useState('0.400');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    const fx = Number(freqX);
    const fy = fw.reprap ? fx : Number(freqY);
    const [start, end] = [Number(dampStart), Number(dampEnd)];
    if ([fx, fy, start, end].some((v) => !Number.isFinite(v)) || fx < 0 || fx > 500 || fy < 0 || fy > 500) {
      return setError('Please input valid values:\n(0 < Freq < 500)');
    }
    if (start < 0 || end > 1 || start >= end) {
      return setError('Please input a valid damping factor (0 <= DampingStart < DampingEnd <= 1)');
    }
    setError(null);
    setLoading(true);
    try {
      const m = MODELS[model];
      await runOtherCalibration('Input shaping damping', {
        mode: CALIB_MODE.damp, start, end, test_model: model, freqStartX: fx, freqStartY: fy, shaper_type: fw.shaperTypes[type]
      }, { [m.drc]: m.url });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <CalibrationDialogWrapper title="Input shaping Damp test" onClose={onClose} onOk={run} error={error} isLoading={loading}>
      <Radios label="Test model" options={MODELS.slice(0, 2).map((m) => m.label)} value={model} onChange={setModel} />
      <Radios label="Input shaper type" options={fw.shaperTypes} value={type} onChange={setType} />
      <Note>{fw.note}</Note>
      {fw.reprap ? (
        <Field label="Frequency" unit="Hz" value={freqX} onChange={setFreqX} />
      ) : (
        <>
          <Field label="Frequency X" unit="Hz" value={freqX} onChange={setFreqX} />
          <Field label="Frequency Y" unit="Hz" value={freqY} onChange={setFreqY} />
        </>
      )}
      <Field label="Damp start" value={dampStart} onChange={setDampStart} />
      <Field label="Damp end" value={dampEnd} onChange={setDampEnd} />
      <Note>Note: Use previously calculated frequencies.</Note>
    </CalibrationDialogWrapper>
  );
}

function CorneringDialog({ onClose }: { onClose: () => void }) {
  const fw = useFirmware();
  const jd = fw.junctionDeviation;
  const [model, setModel] = useState(0);
  const [start, setStart] = useState(jd ? '0.000' : '1.000');
  const [end, setEnd] = useState(jd ? '0.250' : '15.000');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const maxEnd = jd ? 0.3 : 100;
  const warnAbove = jd ? 0.25 : 20;

  const run = async () => {
    const [s, e] = [Number(start), Number(end)];
    if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e > maxEnd || s >= e) {
      return setError(`Please input valid values:\n(0 <= Cornering <= ${maxEnd.toFixed(3)})`);
    }
    setError(null);
    setLoading(true);
    try {
      const m = MODELS[model];
      await runOtherCalibration('Cornering', { mode: CALIB_MODE.cornering, start: s, end: e, test_model: model }, { [m.drc]: m.url });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <CalibrationDialogWrapper title="Cornering test" onClose={onClose} onOk={run} error={error} isLoading={loading}>
      <Radios label="Test model" options={MODELS.map((m) => m.label)} value={model} onChange={setModel} />
      <Field label="Start" unit={jd ? 'mm' : 'mm/s'} value={start} onChange={setStart} />
      <Field label="End" unit={jd ? 'mm' : 'mm/s'} value={end} onChange={setEnd} />
      <Note>Note: Lower values = sharper corners but slower speeds.</Note>
      {Number(end) > warnAbove && <Note>{`NOTE: High values may cause Layer shift (>${warnAbove.toFixed(3)})`}</Note>}
      {fw.flavor === 'marlin2' && <Note>{jd
        ? 'Marlin 2 Junction Deviation detected:\nTo test Classic Jerk, set \'Maximum Junction Deviation\' in Motion ability to 0.'
        : 'Marlin 2 Classic Jerk detected:\nTo test Junction Deviation, set \'Maximum Junction Deviation\' in Motion ability to a value > 0.'}</Note>}
      {fw.reprap && <Note>{'RepRap detected: Jerk in mm/s.\nOrcaSlicer will convert the values to mm/min when necessary.'}</Note>}
    </CalibrationDialogWrapper>
  );
}

export function InputShapingDialogs() {
  const { isOpen, mode, closeDialog } = useInputShapingStore();
  if (!isOpen || !mode) return null;
  if (mode === 'freq') return <FrequencyDialog onClose={closeDialog} />;
  return mode === 'damp' ? <DampingDialog onClose={closeDialog} /> : <CorneringDialog onClose={closeDialog} />;
}
