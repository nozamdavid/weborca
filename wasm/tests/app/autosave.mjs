#!/usr/bin/env node
/** Browser test of autosave and recovery: a backup is offered after a reload, restores the objects, and Discard drops it. */
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { startServer, stopServer } from './lib/dist.mjs';

const PORT = parseInt(process.env.PORT || '5118', 10);
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function runSuite(browserType, name) {
  const browser = await browserType.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 850 } });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.error(`[${name} pageerror]`, err));
  const log = (msg) => console.log(`[${name}] ${msg}`);
  const waitForBackup = async (predicate) => {
    const deadline = Date.now() + 10000;
    do {
      if (await page.evaluate(predicate)) return;
      await page.waitForTimeout(100);
    } while (Date.now() < deadline);
    assert.fail('The expected recovery backup was not persisted');
  };
  const ready = async () => {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
  };

  try {
    await ready();
    assert.equal(await page.locator('#recovery-dialog').count(), 0, 'nothing to recover on a fresh start');
    assert.equal(await page.locator('#autosave-status').count(), 0, 'no last-save claim before the first backup');

    log('an empty plate writes no backup');
    assert.equal(await page.evaluate(() => window.__autosave.writeAutosave()), false);

    log('autosave disabled does not produce backup');
    await page.evaluate(() => { window.__prefsStore.getState().setGeneralPref('autosave', false); });
    await page.evaluate(() => window.__appStore.getState().applyOptionChange('notes', 'Disabled autosave', 'print'));
    await page.waitForTimeout(1000); // Wait a bit to ensure no backup happens
    assert.equal(await page.evaluate(() => window.__autosave.readAutosave()), undefined);
    assert.equal(await page.locator('#autosave-status').count(), 0, 'disabled autosave has no status');

    log('autosave enabled interval actually writes updated settings');
    await page.evaluate(() => { 
        window.__prefsStore.getState().setGeneralPref('autosaveIntervalSeconds', 5);
        window.__prefsStore.getState().setGeneralPref('autosave', true); 
    });
    await page.waitForFunction(() => document.querySelector('.topbar-right #autosave-status')?.textContent === 'Auto saving...');
    // Setting autosave=true will mark dirty and flush, wait for it
    await page.waitForTimeout(1500); 
    let savedNotes2 = await page.evaluate(async () => (await window.__autosave.readAutosave())?.setup?.options?.notes);
    assert.equal(savedNotes2, 'Disabled autosave', 'automatic backup completes after enable');
    assert.equal(await page.locator('#autosave-status').innerText(), 'Auto saving...', 'saving indication lasts at least two seconds');
    await page.waitForFunction(() => /^Last saved \d+ seconds ago$/.test(document.querySelector('#autosave-status')?.textContent || ''));
    const elapsed = Number((await page.locator('#autosave-status').innerText()).match(/\d+/)[0]);
    await page.waitForFunction(previous => Number(document.querySelector('#autosave-status')?.textContent?.match(/\d+/)?.[0]) > previous, elapsed);
    
    await page.evaluate(() => window.__appStore.getState().applyOptionChange('notes', 'Interval test', 'print'));
    await waitForBackup(async () => (await window.__autosave.readAutosave())?.setup?.options?.notes === 'Interval test');

    log('settings-only edits are backed up and recover after reload');
    await page.evaluate(() => window.__appStore.getState().applyOptionChange('notes', 'Recover these project notes', 'print'));
    await waitForBackup(async () => (await window.__autosave.readAutosave())?.setup?.options?.notes === 'Recover these project notes');
    await ready();
    await page.waitForSelector('#recovery-dialog', { timeout: 5000 });
    await page.click('#recovery-restore');
    await page.waitForFunction(() => window.__appStore.getState().currentConfig.notes === 'Recover these project notes');
    await page.waitForSelector('#recovery-dialog', { state: 'detached' });

    log('a plate with an object and notes is backed up');
    await page.evaluate(() => window.__appStore.getState().applyOptionChange('notes', 'Notes with object', 'print'));
    await page.mouse.click(1000, 300, { button: 'right' });
    await page.hover('#plate-menu-primitive');
    await page.click('#plate-menu-cube');
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 1, null, { timeout: 120000 });
    assert.equal(await page.evaluate(() => window.__autosave.writeAutosave()), true);

    log('discarding a backup invalidates an in-progress writer');
    const canceledWrite = await page.evaluate(async () => {
      window.__prefsStore.getState().setGeneralPref('autosave', false);
      const pending = window.__autosave.writeAutosave();
      await window.__autosave.clearAutosave();
      return await pending;
    });
    assert.equal(canceledWrite, false);
    assert.equal(await page.evaluate(() => window.__autosave.readAutosave()), undefined);
    await page.evaluate(() => window.__prefsStore.getState().setGeneralPref('autosave', true));
    assert.equal(await page.evaluate(() => window.__autosave.writeAutosave()), true);

    log('after a reload the backup is offered and restores the object and notes');
    await ready();
    await page.waitForSelector('#recovery-dialog', { timeout: 5000 });
    assert.match(await page.locator('#recovery-dialog').innerText(), /1 object/);
    await page.click('#recovery-restore');
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 1, null, { timeout: 60000 });
    assert.equal(await page.evaluate(() => window.__appStore.getState().currentConfig.notes), 'Notes with object');
    await page.waitForSelector('#recovery-dialog', { state: 'detached' });

    log('Escape dismisses the offer while preserving the backup');
    assert.equal(await page.evaluate(() => window.__autosave.writeAutosave()), true);
    await ready();
    await page.waitForSelector('#recovery-dialog', { timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.waitForSelector('#recovery-dialog', { state: 'detached' });
    assert.equal(await page.evaluate(async () => (await window.__autosave.readAutosave())?.objects), 1);

    log('notes editor dirty dismissal');
    // We already dismissed the recovery dialog with Escape, but a reload (ready) will make it reappear.
    await ready();
    
    // The recovery dialog reappears because Escape just dismissed the dialog, it didn't clear the backup.
    await page.waitForSelector('#recovery-dialog', { timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.waitForSelector('#recovery-dialog', { state: 'detached' });
    
    // open project notes dialog
    await page.click('button.menu-label:has-text("File")');
    await page.waitForSelector('.menu-popup', { state: 'visible' });
    await page.click('.menu-item:has-text("Project notes...")');
    
    await page.waitForSelector('#project-notes');
    await page.fill('#project-notes', 'Dirty notes content');
    // hit cancel
    await page.click('button:has-text("Cancel")');
    // discard dialog should appear
    await page.waitForSelector('.modal-content:has-text("Discard")');
    await page.click('[data-testid="confirm-ok"]');
    await page.waitForSelector('#project-notes', { state: 'detached' });
    
    log('notes editor roundtrip');
    await page.click('button.menu-label:has-text("File")');
    await page.waitForSelector('.menu-popup', { state: 'visible' });
    await page.click('.menu-item:has-text("Project notes...")');
    await page.waitForSelector('#project-notes');
    await page.fill('#project-notes', 'Roundtrip notes content');
    await page.click('#project-notes-save');
    await page.waitForSelector('#project-notes', { state: 'detached' });
    assert.equal(await page.evaluate(() => window.__appStore.getState().currentConfig.notes), 'Roundtrip notes content');

    log('multiline notes preserve literal backslashes and quotes on reopen');
    const literalNotes = 'First line\nC:\\new\\test; "quoted"';
    await page.click('button.menu-label:has-text("File")');
    await page.click('.menu-item:has-text("Project notes...")');
    await page.fill('#project-notes', literalNotes);
    await page.click('#project-notes-save');
    await page.waitForSelector('#project-notes', { state: 'detached' });
    await page.click('button.menu-label:has-text("File")');
    await page.click('.menu-item:has-text("Project notes...")');
    await page.waitForFunction(() => !document.querySelector('#project-notes')?.disabled);
    assert.equal(await page.locator('#project-notes').inputValue(), literalNotes);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.evaluate(() => window.__appStore.getState().applyOptionChange('notes', 'Roundtrip notes content', 'print'));

    log('deleting the last model retains a settings-only recovery point');
    await page.mouse.click(1000, 300, { button: 'right' });
    await page.hover('#plate-menu-primitive');
    await page.click('#plate-menu-cube');
    await page.waitForFunction(() => window.__plateStore.getState().objects.length === 1);
    assert.equal(await page.evaluate(() => window.__autosave.writeAutosave()), true);
    await page.evaluate(() => window.__plateStore.getState().deleteAll());
    await waitForBackup(async () => {
      const backup = await window.__autosave.readAutosave();
      return backup?.objects === 0 && backup.setup?.options?.notes === 'Roundtrip notes content';
    });
    const settingsBackup = await page.evaluate(() => window.__autosave.readAutosave());
    assert.equal(settingsBackup.bytes, undefined, 'deleted geometry must not return on recovery');
    await ready();
    await page.waitForSelector('#recovery-dialog');
    await page.click('#recovery-restore');
    await page.waitForSelector('#recovery-dialog', { state: 'detached' });
    assert.equal(await page.evaluate(() => window.__plateStore.getState().objects.length), 0);
    assert.equal(await page.evaluate(() => window.__appStore.getState().currentConfig.notes), 'Roundtrip notes content');

    log('empty multi-plate recovery retains names, locks, settings and the active plate');
    await page.evaluate(async () => {
      await window.__platesStore.getState().addPlate('Recovery plate');
      await window.__platesStore.getState().setPlateConfig(1, { curr_bed_type: 'Textured PEI Plate' }, 'Recovery plate', true);
      window.__platesStore.getState().setActivePlate(1);
    });
    await waitForBackup(async () => {
      const backup = await window.__autosave.readAutosave();
      return backup?.plateState?.plates.length === 2 && backup.plateState.activePlateIndex === 1;
    });
    await ready();
    await page.waitForSelector('#recovery-dialog');
    await page.click('#recovery-restore');
    await page.waitForSelector('#recovery-dialog', { state: 'detached' });
    const recoveredPlate = await page.evaluate(() => ({ active: window.__platesStore.getState().activePlateIndex, plate: window.__platesStore.getState().plates[1] }));
    assert.equal(recoveredPlate.active, 1);
    assert.equal(recoveredPlate.plate.name, 'Recovery plate');
    assert.equal(recoveredPlate.plate.locked, true);
    assert.equal(recoveredPlate.plate.config.curr_bed_type, 'Textured PEI Plate');
    assert.equal(await page.evaluate(() => window.__plateStore.getState().objects.length), 0);

    log('Discard removes the backup');
    await ready();
    await page.waitForSelector('#recovery-dialog', { timeout: 5000 });
    await page.click('#recovery-discard');
    await page.waitForSelector('#recovery-dialog', { state: 'detached' });
    assert.equal(await page.evaluate(() => window.__autosave.readAutosave()), undefined);
    await ready();
    assert.equal(await page.locator('#recovery-dialog').count(), 0);
    log('all checks passed');
  } catch (err) {
    console.error(await page.evaluate(async () => ({ text: document.body.innerText.slice(0, 600), backup: await window.__autosave?.readAutosave(), ready: window.__appStore?.getState().isEngineReady })));
    throw err;
  } finally {
    await browser.close();
  }
}

await startServer(PORT, 'autosave');
try {
  await runSuite(chromium, 'chromium');
  await runSuite(firefox, 'firefox');
  console.log('All autosave tests passed on Chromium and Firefox.');
} catch (err) {
  console.error('Autosave tests FAILED:', err);
  process.exitCode = 1;
} finally {
  await stopServer(PORT);
}
