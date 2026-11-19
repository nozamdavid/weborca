import { confirmDialog } from '../components/ModalBackdrop';
import { getEngine } from '../engine/orcaEngine';
import { useHistoryStore } from '../history';
import { restorePlatesOnEmptyCanvas } from '../history/historyStore';
import { usePlateStore } from '../plate/plateStore';
import { isDefaultPlateName } from '../plates/plateName';
import { usePlatesStore } from '../plates/platesStore';
import { usePreviewStore } from '../preview/previewStore';
import { useAppStore } from '../store/appStore';
import { showToast } from './toastStore';

function projectActionBusy() {
  const app = useAppStore.getState();
  return !app.isEngineReady || app.isModelLoading || app.isSlicing || app.isSelectingPreset ||
    app.sessionRecovery === 'restoring' || Object.keys(app.pendingOptions).length > 0 ||
    useHistoryStore.getState().isRestoring;
}

async function approveProjectReplacement(confirmLabel: string) {
  if (projectActionBusy()) return false;

  const app = useAppStore.getState();
  const { plates } = usePlatesStore.getState();
  // There is no reliable saved/dirty marker. Protect populated projects and
  // workspace changes such as notes, custom plates and edited setup.
  const hasProject = app.modelFile || app.sliceResult || usePlateStore.getState().objects.length ||
    app.currentConfig.notes?.trim() || app.selectedFilaments.length > 1 ||
    [app.processOverrides, app.printerOverrides, app.filamentOverrides].some(map => Object.keys(map).length) ||
    plates.length > 1 || plates.some(plate =>
      plate.locked || !isDefaultPlateName(plate.name, plate.index) || Object.keys(plate.config).length);
  if (!hasProject) return true;

  return confirmDialog({
    title: 'Close the current project?',
    message: 'Unsaved changes are lost.',
    confirmLabel,
    cancelLabel: 'Cancel'
  });
}

/** User-facing project open. Recovery and history use the loader directly. */
export async function requestOpenProject(file: File) {
  if (!(await approveProjectReplacement('Open')) || projectActionBusy()) return false;
  return useAppStore.getState().openProjectFile(file);
}

export async function requestNewProject() {
  if (!(await approveProjectReplacement('New project')) || projectActionBusy()) return;

  const app = useAppStore.getState();
  useAppStore.setState({ isModelLoading: true, sliceStatusText: '' });
  try {
    await usePlateStore.getState().deleteAll();
    await restorePlatesOnEmptyCanvas(await getEngine());
    await app.applyOptionChange('notes', '', 'print');
    app.invalidateSlicePreview();
    useAppStore.setState({ modelFile: null, modelObjects: null });
    usePreviewStore.getState().resetGcodeAction();
    await useHistoryStore.getState().initHistory();
    await (await import('./autosave')).clearAutosave();
  } catch (error) {
    showToast(`Failed to start a new project: ${error instanceof Error ? error.message : String(error)}`, 'error');
  } finally {
    useAppStore.setState({ isModelLoading: false });
  }
}
