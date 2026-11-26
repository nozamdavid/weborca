import { useAppStore } from '../store/appStore';
import { useHistoryStore } from '../history';
import { requestOpenProject } from '../shell/projectActions';
import { showToast } from '../shell/toastStore';

let importingDrop = false;

export function isDroppedModelFile(file: File) {
  return /\.(3mf|stl|obj|amf|step|stp|svg|zip)$/i.test(file.name);
}

/** Keep dialogs and native model mutations in drop order. */
export async function importDroppedFiles(files: readonly File[]) {
  if (importingDrop) return;
  importingDrop = true;
  try {
    const models = files.filter(isDroppedModelFile);
    for (const file of models) {
      const app = useAppStore.getState();
      if (!app.isEngineReady || app.isSlicing || app.isModelLoading || app.stepImportState || useHistoryStore.getState().isRestoring) return;
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext === '3mf' && models.length === 1) {
        if (!(await requestOpenProject(file))) return;
      } else {
        await app.requestImportFile(file);
      }
    }
  } catch (error) {
    showToast(`Failed to import dropped file: ${error instanceof Error ? error.message : String(error)}`, 'error');
  } finally {
    importingDrop = false;
  }
}
