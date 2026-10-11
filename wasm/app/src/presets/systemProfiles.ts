/** Unflattened system profiles preserve desktop ancestry and decorative bed asset metadata. */
export interface SystemProfile {
  name: string;
  inherits?: string;
  instantiation?: string | boolean;
  printer_model?: string;
  bed_model?: string;
  bed_texture?: string;
}
const bundles = new Map<string, Promise<Record<string, string>>>();

export async function systemProfiles(vendor: string, directory: 'machine' | 'process' | 'filament'): Promise<SystemProfile[]> {
  if (!vendor) return [];
  let pending = bundles.get(vendor);
  if (!pending) {
    pending = fetch(`/profiles/${encodeURIComponent(vendor)}.json`).then(async (response) => {
      if (!response.ok) throw new Error(`Could not load ${vendor} profiles`);
      return (await response.json()).files as Record<string, string>;
    });
    bundles.set(vendor, pending);
    void pending.catch(() => bundles.delete(vendor));
  }
  const files = await pending;
  return Object.entries(files).filter(([path]) => path.includes(`/${directory}/`) && path.endsWith('.json')).map(([, json]) => JSON.parse(json) as SystemProfile);
}
