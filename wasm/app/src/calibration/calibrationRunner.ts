import { usePlateStore } from '../plate/plateStore';
import { useObjectListStore } from '../objectlist/objectListStore';
import { useAppStore } from '../store/appStore';
import { useHistoryStore } from '../history';
import { setOptions, getConfig, getEngine } from '../engine/orcaEngine';
import type { HistorySnapshot } from '../history/types';

/**
 * Checks whether a snapshot represents a valid retained history state.
 * Empty snapshots are valid with no slot. Nonempty snapshots require an allocated slot and filePath.
 */
function isValidHistorySnapshot(snap: HistorySnapshot | null | undefined): boolean {
  if (!snap) return false;
  if (snap.isEmpty) return true;
  return (
    typeof snap.filePath === 'string' &&
    snap.filePath.length > 0 &&
    typeof snap.slotId === 'number' &&
    snap.slotId >= 0
  );
}

export async function withCalibrationProjectSafety<T>(
  name: string,
  fn: () => Promise<T>
): Promise<T> {
  const historyStore = useHistoryStore.getState();
  const appStore = useAppStore.getState();
  const plateStore = usePlateStore.getState();

  // Snapshot pre-calibration state for rollback on failure
  const prevCurrentSnapshot = historyStore.currentSnapshot;
  const prevConfig = { ...appStore.currentConfig };
  const prevProcessOverrides = { ...appStore.processOverrides };
  const prevModelFile = appStore.modelFile;
  const prevModelObjects = appStore.modelObjects;

  const isNonEmpty = plateStore.objects.length > 0;

  // 1. Commit pre-calibration transaction to history for undo rollback
  await historyStore.commitTransaction(`Before ${name}`);
  const preCalibSnapshot = useHistoryStore.getState().currentSnapshot;

  // Fail-closed check before replacing any nonempty project:
  // Require successful current snapshot filePath (and appropriate snapshot state),
  // otherwise show error and leave project untouched.
  if (isNonEmpty) {
    const isSnapshotValid =
      isValidHistorySnapshot(preCalibSnapshot) &&
      preCalibSnapshot?.isEmpty === false;

    if (!isSnapshotValid) {
      // Revert historyStore to valid retained state, discarding failed snapshot with freed/invalid slot
      // Do not reintroduce history entries whose slot files were evicted
      const currentHist = useHistoryStore.getState();
      const validPast = currentHist.past
        .slice(0, -1)
        .filter(isValidHistorySnapshot);

      const targetSnapshot =
        isValidHistorySnapshot(prevCurrentSnapshot)
          ? prevCurrentSnapshot
          : (validPast.length > 0 ? validPast[validPast.length - 1] : null);

      const finalPast = validPast.filter((s) => s.id !== targetSnapshot?.id);
      const totalBytes =
        (targetSnapshot?.byteSize || 1024) +
        finalPast.reduce((sum, s) => sum + (s.byteSize || 1024), 0);

      useHistoryStore.setState({
        past: finalPast,
        currentSnapshot: targetSnapshot,
        canUndo: finalPast.length > 0,
        canRedo: false,
        totalRetainedBytes: totalBytes
      });

      throw new Error('Failed to create project snapshot backup before calibration. Current project preserved.');
    }
  }

  try {
    const result = await fn();
    // Commit post-calibration transaction to history
    await useHistoryStore.getState().commitTransaction(name);
    return result;
  } catch (err: any) {
    console.error(`[${name}] Calibration setup failed, rolling back:`, err);
    // Complete rollback to pre-calibration state
    try {
      // 1. Restore engine model from preCalibSnapshot
      try {
        const engine = await getEngine();
        if (preCalibSnapshot) {
          if (preCalibSnapshot.isEmpty) {
            let currentObjs: any[] = [];
            try {
              currentObjs = await engine.listObjects();
            } catch (_) {}
            for (const obj of currentObjs) {
              try {
                await engine.deleteObject(obj.id);
              } catch (_) {}
            }
            usePlateStore.setState({ objects: [], selectedObjectId: null, selectedInstanceId: null });
            useObjectListStore.setState({ objects: [], selectedObjectId: null, selectedVolumeId: null });
            useAppStore.setState({ modelFile: null, modelObjects: null });
          } else if (preCalibSnapshot.filePath) {
            await engine.call('openProject', { path: preCalibSnapshot.filePath });
          }
        }
      } catch (engineModelErr) {
        console.warn(`[${name}] Failed to restore engine model during rollback:`, engineModelErr);
      }

      // 2. Restore engine options and sync app currentConfig
      let restoredEffectiveConfig = prevConfig;
      try {
        await setOptions(prevConfig);
        restoredEffectiveConfig = await getConfig();
      } catch (optErr) {
        console.warn(`[${name}] Failed to restore engine options during rollback:`, optErr);
      }

      // 3. Always restore appStore config and processOverrides on late failure
      useAppStore.setState({
        currentConfig: restoredEffectiveConfig,
        processOverrides: prevProcessOverrides,
        modelFile: prevModelFile,
        modelObjects: prevModelObjects,
        sliceResult: null,
        gcodeUrl: null
      });

      // 4. Refresh plate objects and object list
      try {
        const pStore = usePlateStore.getState();
        await pStore.refreshObjects();
        const oStore = useObjectListStore.getState();
        await oStore.refreshTree();
      } catch (refreshErr) {
        console.warn(`[${name}] Failed to refresh UI stores during rollback:`, refreshErr);
      }

      // 5. Only restore valid retained state in history store without referring to freed/evicted slots
      const currentHist = useHistoryStore.getState();
      const allCandidatePast = currentHist.past.filter(isValidHistorySnapshot);

      const targetSnapshot =
        isValidHistorySnapshot(preCalibSnapshot)
          ? preCalibSnapshot
          : (isValidHistorySnapshot(prevCurrentSnapshot)
              ? prevCurrentSnapshot
              : (allCandidatePast.length > 0 ? allCandidatePast[allCandidatePast.length - 1] : null));

      const finalPast = allCandidatePast.filter((s) => s.id !== targetSnapshot?.id);
      const totalBytes =
        (targetSnapshot?.byteSize || 1024) +
        finalPast.reduce((sum, s) => sum + (s.byteSize || 1024), 0);

      useHistoryStore.setState({
        past: finalPast,
        currentSnapshot: targetSnapshot,
        canUndo: finalPast.length > 0,
        canRedo: false,
        totalRetainedBytes: totalBytes
      });
    } catch (rollbackErr) {
      console.error(`[${name}] Rollback failed:`, rollbackErr);
    }

    // Re-throw so caller knows generation failed
    throw err;
  }
}
