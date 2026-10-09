/**
 * @file index.ts
 * 3D Text & Emboss tool for OrcaSlicer Web.
 *
 * MOUNTING & HISTORY INTEGRATION SPECIFICATION:
 * ---------------------------------------------------------------------------
 * 1. PlateView Toolbar Button & Panel Mounting (wasm/app/src/plate/PlateView.tsx):
 *    Add a toolbar button to #plate-toolbar alongside Face Paint & Variable Layers:
 *    ```tsx
 *    import { TextPanel, useTextStore } from '../text';
 *    ...
 *    <button
 *      id=\"tool-text-btn\"
 *      data-testid=\"tool-text-btn\"
 *      className={`btn-tool ${useTextStore((s) => s.isOpen) ? 'active' : ''}`}
 *      onClick={() => {
 *        const store = useTextStore.getState();
 *        if (store.isOpen) {
 *          store.close();
 *        } else {
 *          store.openForAdd(selectedObjectId);
 *        }
 *      }}
 *      title=\"3D Text / Emboss tool\"
 *    >
 *      🔤 Text
 *    </button>
 *    ```
 *    Render `<TextPanel />` inside the PlateView root container alongside `<PaintToolsPanel />`
 *    and `<LayerHeightPanel />`:
 *    ```tsx
 *    <TextPanel />
 *    ```
 *
 * 2. 3D PlateScene Raycast Click-to-Place (wasm/app/src/plate/PlateScene.ts):
 *    When text placement mode is active on click/pointerup:
 *    ```tsx
 *    import { placeTextAtHit } from '../text';
 *    ...
 *    if (isTextPlacing && intersect) {
 *      placeTextAtHit({
 *        objectId: intersectObject?.userData?.objectId ?? null,
 *        hit: [intersect.point.x, intersect.point.y, intersect.point.z],
 *        normal: intersect.face ? [intersect.face.normal.x, intersect.face.normal.y, intersect.face.normal.z] : [0, 0, 1]
 *      });
 *    }
 *    ```
 *
 * 3. Object List Context Menu (wasm/app/src/objectlist/ContextMenu.tsx & ObjectTreeItem.tsx):
 *    Add an "Edit 3D Text" option when right-clicking text volumes:
 *    ```tsx
 *    import { useTextStore } from '../text';
 *    ...
 *    {isTextVolume && (
 *      <div
 *        id=\"menu-item-edit-text\"
 *        data-testid=\"menu-item-edit-text\"
 *        className=\"context-menu-item\"
 *        onClick={() => {
 *          void useTextStore.getState().openForEdit(objectId, volumeId);
 *          onClose();
 *        }}
 *      >
 *        🔤 Edit 3D Text
 *      </div>
 *    )}
 *    ```
 *
 * 4. History / Undo-Redo & Scene Cache Hooks:
 *    - `useTextStore` automatically hooks into `usePlateStore.getState().refreshObjects()`
 *      and `useObjectListStore.getState().refreshTree()` after `addText` and `updateText`.
 *    - `useTextStore` records transactions in `useHistoryStore.getState().commitTransaction('Add 3D text')`
 *      and `commitTransaction('Update 3D text')`.
 * ---------------------------------------------------------------------------
 */

export * from './types';
export * from './textApi';
export * from './textStore';
export * from './placementHelper';
export { TextPanel } from './TextPanel';
