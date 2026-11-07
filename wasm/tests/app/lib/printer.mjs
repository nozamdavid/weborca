/** Store-based setup for tests whose subject is not the picker. Picker tests must use selectOption themselves. */
const DEFAULT_PRESET = { Voron: 'Voron 2.4 300 0.4 nozzle', BBL: 'Bambu Lab X1 Carbon 0.4 nozzle' };

export async function selectAddedPrinter(page, vendor, preset = DEFAULT_PRESET[vendor], timeout = 60000) {
  if (!preset) throw new Error(`selectAddedPrinter: no default preset for ${vendor}`);
  await page.waitForFunction(() => window.__appStore?.getState().isEngineReady && !window.__appStore.getState().isSelectingPreset, null, { timeout });
  // Persist the preset as an added printer, the way the Add printer wizard does.
  await page.evaluate((name) => {
    const saved = JSON.parse(localStorage.getItem('orca.wizard') || '{}');
    const printers = [...new Set([...(saved.printers || []), name])];
    localStorage.setItem('orca.wizard', JSON.stringify({ ...saved, printers, filaments: saved.filaments || [] }));
  }, preset);
  // Writing storage does not update the already-mounted wizard store. Select through
  // the setup API consistently, including when the same preset is already displayed.
  await page.evaluate(async ({ vendor: v, name }) => {
    await window.__appStore.getState().chooseVendor(v);
    await window.__appStore.getState().choosePrinter(name);
    const state = window.__appStore.getState();
    if (state.engineError) throw new Error(state.engineError);
  }, { vendor, name: preset });
  await page.waitForFunction((name) => {
    const s = window.__appStore.getState();
    return s.selectedPrinter === name && !!s.selectedProcess && !!s.selectedFilaments[0] && !s.engineError && !s.isSelectingPreset && document.getElementById('printer-select')?.value === name;
  }, preset, { timeout });
}

/** Lists the presets as added printers on every page load, so tests can pick them through the dropdown itself. */
export async function seedAddedPrinters(pageOrContext, presets) {
  await pageOrContext.addInitScript((names) => {
    const saved = JSON.parse(localStorage.getItem('orca.wizard') || '{}');
    const printers = [...new Set([...(saved.printers || []), ...names])];
    localStorage.setItem('orca.wizard', JSON.stringify({ ...saved, printers, filaments: saved.filaments || [] }));
  }, presets);
}
