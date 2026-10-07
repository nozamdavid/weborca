import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

let playwright;
try {
    playwright = await import('playwright');
} catch {
    playwright = await import('../build/web-smoke/node_modules/playwright/index.mjs');
}
const { chromium } = playwright;

const PORT = 5055;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PAGE_URL = `${BASE_URL}/wasm/web-smoke/index.html`;

async function isServerRunning() {
    return new Promise((resolve) => {
        const req = http.get(`${BASE_URL}/wasm/web-smoke/serve.json`, (res) => {
            resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(1000, () => {
            req.destroy();
            resolve(false);
        });
    });
}

async function waitForServer(timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await isServerRunning()) return true;
        await new Promise((r) => setTimeout(r, 300));
    }
    return false;
}

let serverProcess = null;

async function startServerIfNeeded() {
    if (await isServerRunning()) {
        console.log(`Static server already running at ${BASE_URL}`);
        return;
    }

    console.log(`Starting static server on port ${PORT}...`);
    serverProcess = spawn(
        'npx',
        [
            '--prefix',
            'wasm/build/web-smoke',
            'serve',
            '.',
            '-c',
            'wasm/web-smoke/serve.json',
            '-l',
            String(PORT),
            '--no-clipboard',
            '-L'
        ],
        {
            cwd: repoRoot,
            stdio: 'inherit'
        }
    );

    const ready = await waitForServer();
    if (!ready) {
        throw new Error(`Server failed to start on port ${PORT} within timeout`);
    }
    console.log(`Server is ready at ${BASE_URL}`);
}

async function main() {
    let browser;
    const consoleErrors = [];

    try {
        await startServerIfNeeded();

        console.log('Launching Playwright Chromium...');
        browser = await chromium.launch({
            headless: true,
            args: [
                '--enable-features=SharedArrayBuffer',
                '--js-flags=--experimental-wasm-memory64'
            ]
        });

        const context = await browser.newContext();
        const page = await context.newPage();

        page.on('console', (msg) => {
            if (msg.type() === 'error') {
                consoleErrors.push(msg.text());
                console.error(`[Browser Console Error] ${msg.text()}`);
            } else {
                console.log(`[Browser Console ${msg.type()}] ${msg.text()}`);
            }
        });

        page.on('pageerror', (err) => {
            const errStr = err.stack || err.message || String(err);
            consoleErrors.push(errStr);
            console.error(`[Browser Page Error] ${errStr}`);
        });

        page.on('worker', (worker) => {
            console.log(`[Browser Worker Spawned] ${worker.url()}`);
        });

        console.log(`Navigating to ${PAGE_URL}...`);
        await page.goto(PAGE_URL, { waitUntil: 'load' });

        const isIsolated = await page.evaluate(() => window.crossOriginIsolated);
        console.log(`Verified page window.crossOriginIsolated: ${isIsolated}`);
        if (!isIsolated) {
            throw new Error('window.crossOriginIsolated is false! Check COOP/COEP headers.');
        }

        console.log('Clicking "Slice" button...');
        await page.click('#slice-btn');

        console.log('Waiting up to 120 seconds for slicing to complete...');
        await page.waitForFunction(
            () => {
                const log = document.getElementById('log')?.textContent || '';
                return log.includes('STATUS: SUCCESS') || log.includes('STATUS: ERROR');
            },
            null,
            { timeout: 120_000 }
        );

        const pageLog = await page.$eval('#log', (el) => el.textContent);
        console.log('\n================ PAGE LOG ================');
        console.log(pageLog);
        console.log('==========================================\n');

        if (pageLog.includes('STATUS: ERROR')) {
            throw new Error('Slicing failed with error in page log.');
        }

        console.log('--- Verification Summary ---');
        console.log(`crossOriginIsolated: ${isIsolated}`);
        console.log(`Browser console errors captured: ${consoleErrors.length}`);
        if (consoleErrors.length > 0) {
            for (const err of consoleErrors) {
                console.log(`  - ${err}`);
            }
        }

        console.log('Run completed successfully.');
    } finally {
        if (browser) {
            await browser.close();
        }
        if (serverProcess) {
            console.log('Stopping static server...');
            serverProcess.kill('SIGTERM');
        }
    }
}

main().catch((err) => {
    console.error('Fatal error during execution:', err);
    process.exit(1);
});
