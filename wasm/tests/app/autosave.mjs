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
  const ready = async () => {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
  };

  try {
    await ready();
    assert.equal(await page.locator('#recovery-dialog').count(), 0, 'nothing to recover on a fresh start');

    log('an empty plate writes no backup');
    assert.equal(await page.evaluate(() => window.__autosave.writeAutosave()), false);

    log('autosave disabled does not produce backup');
    await page.evaluate(() => { window.__prefsStore.getState().setGeneralPref('autosave', false); });
    await page.evaluate(() => window.__appStore.getState().applyOptionChange('notes', 'Disabled autosave', 'print'));
    await page.waitForTimeout(1000); // Wait a bit to ensure no backup happens
    assert.equal(await page.evaluate(() => window.__autosave.readAutosave()), undefined);

    log('autosave enabled interval actually writes updated settings');
    await page.evaluate(() => { 
        window.__prefsStore.getState().setGeneralPref('autosaveIntervalSeconds', 1);
        window.__prefsStore.getState().setGeneralPref('autosave', true); 
    });
    // Setting autosave=true will mark dirty and flush, wait for it
    await page.waitForTimeout(1500); 
    let savedNotes2 = await page.evaluate(async () => (await window.__autosave.readAutosave())?.setup?.options?.notes);
    assert.equal(savedNotes2, 'Disabled autosave', 'automatic backup completes after enable');
    
    await page.evaluate(() => window.__appStore.getState().applyOptionChange('notes', 'Interval test', 'print'));
    let savedNotes3;
    for (let attempt = 0; attempt < 50; attempt++) {
      savedNotes3 = await page.evaluate(async () => (await window.__autosave.readAutosave())?.setup?.options?.notes);
      if (savedNotes3 === 'Interval test') break;
      await page.waitForTimeout(100);
    }
    assert.equal(savedNotes3, 'Interval test', 'interval writes updated settings');


    log('settings-only edits are backed up and recover after reload');
    await page.evaluate(() => window.__appStore.getState().applyOptionChange('notes', 'Recover these project notes', 'print'));
    let savedNotes;
    for (let attempt = 0; attempt < 50; attempt++) {
      savedNotes = await page.evaluate(async () => (await window.__autosave.readAutosave())?.setup?.options?.notes);
      if (savedNotes === 'Recover these project notes') break;
      await page.waitForTimeout(100);
    }
    assert.equal(savedNotes, 'Recover these project notes', 'automatic backup completes before refreshing');
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
    await page.click('button.btn-danger:has-text("Discard")');
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
