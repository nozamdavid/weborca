import { useAppStore } from '../store/appStore';
import { useHistoryStore } from '../history';
import { slicePrerequisites } from './slicePrerequisites';

/** Both desktop Slice controls use the same prerequisites. */
export function useSliceReadiness(): string {
  const restoring = useHistoryStore(s => s.isRestoring);
  return useAppStore(s => slicePrerequisites(s, restoring));
}
