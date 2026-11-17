import { useEditOpsStore } from './editOpsStore';
import type { CanvasTool } from '../shell/CanvasToolbar';
import { useObjectListStore } from '../objectlist/objectListStore';

export function textureTool(hasSelection: boolean, busy: boolean): CanvasTool {
  return {
    id: 'tool-texture-btn', label: 'Texture displacement', icon: 'toolbar_texture_displacement',
    active: useEditOpsStore.getState().activeDialog === 'texture', disabled: !hasSelection || busy,
    onClick: async () => {
      await useObjectListStore.getState().refreshTree();
      useEditOpsStore.setState({ activeDialog: 'texture', error: null });
    }
  };
}
