import { useWizardStore } from './wizardStore';

export const ADD_FILAMENT = '__add_filament__';

/** Open the existing filament configuration step without selecting a slot preset. */
export function openAddFilament() {
  useWizardStore.getState().setOpen(true, true);
}
