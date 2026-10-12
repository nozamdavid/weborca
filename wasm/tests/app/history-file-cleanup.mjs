#!/usr/bin/env node
/** Retired history backups release their MEMFS contents before slots can be reused. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, stopServer } from './lib/dist.mjs';
let playwright;
try {
  playwright = await import('playwright');
} catch {
  playwright = await import('../node_modules/playwright/index.mjs');
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const port = 5227;
try {
  await startServer(port, 'history-file-cleanup', { frozenDist: process.env.HISTORY_FROZEN_DIST === '1' });
  for (const type of [playwright.chromium, playwright.firefox]) {
    const browser = await type.launch({ headless: true, args: ['--enable-features=SharedArrayBuffer'] });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${port}`);
      await page.waitForFunction(() => window.__appStore?.getState().isEngineReady, null, { timeout: 90000 });
      await page.setInputFiles('#model-file', path.join(root, 'tests/data/20mm_cube.obj'));
      await page.waitForFunction(() => !window.__appStore.getState().isModelLoading && window.__historyStore?.getState().currentSnapshot?.filePath, null, { timeout: 30000 });
      const result = await page.evaluate(async () => {
        const history = window.__historyStore, engine = window.__orcaEngine;
        const paths = () => [...history.getState().past, ...history.getState().future, history.getState().currentSnapshot].filter(s => s?.filePath).map(s => s.filePath);
        const length = async (p) => (await engine.readFile(p)).byteLength;
        const empty = async (owned) => {
          for (const p of new Set(owned)) {
            if (await length(p) !== 0) throw new Error(`Retired backup is not empty: ${p}`);
          }
        };
        const live = async () => {
          for (const p of paths()) {
            if (await length(p) === 0) throw new Error(`Live backup is empty: ${p}`);
          }
        };
        const imported = paths();
        await history.getState().initHistory();
        await empty(imported);
        history.setState({ maxBytes: 1 });
        await history.getState().commitTransaction('First backup');
        const evicted = history.getState().currentSnapshot.filePath;
        await history.getState().commitTransaction('Second backup');
        await history.getState().commitTransaction('Evict old backup');
        await empty([evicted]);
        await live();
        history.setState({ maxBytes: 50 * 1024 * 1024 });
        await history.getState().undo();
        const discarded = history.getState().future.map(s => s.filePath).filter(Boolean);
        await history.getState().commitTransaction('Discard redo');
        await empty(discarded);
        await live();
        const initialized = paths();
        await history.getState().initHistory();
        await empty(initialized);
        await history.getState().commitTransaction('Before clearing');
        const cleared = paths();
        await engine.writeFile('/out/unrelated.3mf', new Uint8Array([7, 8, 9]));
        await engine.writeFile('/out/undo_slot_20.3mf', new Uint8Array([3, 4]));
        await history.getState().clearHistory();
        await empty(cleared);
        if ((await length('/out/unrelated.3mf')) !== 3 || (await length('/out/undo_slot_20.3mf')) !== 2)
          throw new Error('Cleanup touched an unowned file');
        await history.getState().initHistory();
        await history.getState().commitTransaction('Before delayed commit');
        const beforeDelay = paths();
        const originalCall = engine.call.bind(engine);
        let release, entered, delayedPath, held = false;
        const blocked = new Promise(resolve => release = resolve);
        const started = new Promise(resolve => entered = resolve);
        engine.call = async (method, args, ...rest) => {
          if (method === 'saveProject' && !held) {
            held = true;
            delayedPath = args.path;
            entered();
            await blocked;
          }
          return originalCall(method, args, ...rest);
        };
        try {
          const committing = history.getState().commitTransaction('Delayed commit');
          await started;
          const clearing = history.getState().clearHistory();
          release();
          await committing;
          await clearing;
        } finally {
          engine.call = originalCall;
        }
        if (paths().length || history.getState().currentSnapshot !== null)
          throw new Error('Delayed commit resurrected cleared history');
        await empty([...beforeDelay, delayedPath]);
        await history.getState().initHistory();
        await history.getState().commitTransaction('Cleanup failure fixture');
        const failedPath = history.getState().currentSnapshot.filePath;
        const originalWrite = engine.writeFile.bind(engine);
        let failed = false;
        engine.writeFile = async (p, bytes) => {
          if (p === failedPath && !failed) {
            failed = true;
            throw new Error('Injected truncate failure');
          }
          return originalWrite(p, bytes);
        };
        try {
          await history.getState().clearHistory();
        } finally {
          engine.writeFile = originalWrite;
        }
        if (paths().length)
          throw new Error('Retired metadata survived cleanup failure');
        if (!failed || await length(failedPath) === 0)
          throw new Error('Truncate failure was not exercised');
        await history.getState().commitTransaction('After failed cleanup');
        if (history.getState().currentSnapshot.filePath === failedPath)
          throw new Error('An unclean slot was reused');
        await live();
        const retried = paths();
        await history.getState().initHistory();
        await empty([...retried, failedPath]);
        // Eviction failure must leave the newly saved Undo/Redo state usable.
        history.setState({ maxBytes: 1 });
        await history.getState().commitTransaction('Eviction failure first');
        await history.getState().commitTransaction('Eviction failure second');
        const failedEviction = history.getState().past.find(snap => snap.filePath).filePath;
        let evictionFailed = false;
        engine.writeFile = async (p, bytes) => {
          if (p === failedEviction && !evictionFailed) {
            evictionFailed = true;
            throw new Error('Injected eviction truncate failure');
          }
          return originalWrite(p, bytes);
        };
        try {
          await history.getState().commitTransaction('Successful commit despite cleanup failure');
        } finally {
          engine.writeFile = originalWrite;
        }
        if (!evictionFailed || paths().includes(failedEviction)) throw new Error('Filtered eviction metadata was resurrected');
        await live();
        if (!await history.getState().undo() || !await history.getState().redo()) throw new Error('New history is unusable after cleanup failure');
        await live();
        const beforeRetryClear = paths();
        await history.getState().clearHistory();
        await empty([...beforeRetryClear, failedEviction]);
        if (paths().length) throw new Error('Clear resurrected retired snapshot metadata');
        history.setState({ maxBytes: 50 * 1024 * 1024 });

        await history.getState().commitTransaction('Delay cleanup fixture');
        let unblockCleanup, cleanupEntered, paused = false;
        const cleanupBlocked = new Promise(resolve => unblockCleanup = resolve);
        const cleanupStarted = new Promise(resolve => cleanupEntered = resolve);
        engine.writeFile = async (p, bytes) => {
          if (!paused && /^\/out\/undo_slot_\d+\.3mf$/.test(p)) {
            paused = true;
            cleanupEntered();
            await cleanupBlocked;
          }
          return originalWrite(p, bytes);
        };
        try {
          const clearing = history.getState().clearHistory();
          await cleanupStarted;
          const committing = history.getState().commitTransaction('After delayed cleanup');
          unblockCleanup();
          await clearing;
          await committing;
        } finally {
          engine.writeFile = originalWrite;
        }
        await live();
        return { eviction: true, redoDiscard: true, initialization: true, clearing: true, delayedCommit: true, cleanupFailure: true, evictionCleanupFailure: true, retryOnClear: true, noLateWipe: true };
      });
      assert.ok(Object.values(result).every(Boolean));
      console.log(type.name(), result);
    } finally {
      await browser.close();
    }
  }
} finally {
  await stopServer(port);
}
