import { strFromU8, unzipSync } from 'fflate';

const projectSettings = 'metadata/project_settings.config';
export const MAX_FILAMENT_SLOTS = 16;

/** Read only the Orca/Bambu project palette, without applying the embedded printer or process. */
export function readImportedFilamentColours(bytes: Uint8Array): (string | undefined)[] {
  try {
    const entries = unzipSync(bytes, {
      filter: entry => entry.name.toLowerCase() === projectSettings && entry.originalSize <= 1024 * 1024,
    });
    const settings = Object.values(entries)[0];
    if (!settings) return [];
    const { filament_colour: colours } = JSON.parse(strFromU8(settings));
    if (!Array.isArray(colours) || colours.length < 2) return [];
    const palette = colours.slice(0, MAX_FILAMENT_SLOTS).map((colour: unknown) =>
      typeof colour === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(colour)
        ? colour.slice(0, 7).toUpperCase()
        : undefined);
    // Keep positional gaps. Paint and part assignments refer to numbered slots.
    return palette.some(Boolean) ? palette : [];
  } catch {
    // Standalone meshes and malformed optional settings still use normal import.
    return [];
  }
}
