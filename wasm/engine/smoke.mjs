import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import createOrcaEngine from '../build/orca-wasm64/wasm/engine/orca_engine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

function parseArgs() {
    const args = process.argv.slice(2);
    let model = '';
    let outGcode = '';
    let threads = 4;
    let cancelAfterMs = -1;
    let dumpConfig = '';
    let twice = false;
    let cancelBefore = false;

    const positional = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--cancel-after-ms') {
            cancelAfterMs = parseInt(args[++i], 10);
        } else if (arg === '--cancel-before') {
            cancelBefore = true;
        } else if (arg === '--dump-config') {
            dumpConfig = args[++i];
        } else if (arg === '--twice') {
            twice = true;
        } else if (arg.startsWith('--')) {
            console.error(`Unknown option: ${arg}`);
            process.exit(1);
        } else {
            positional.push(arg);
        }
    }

    if (positional.length < 2) {
        console.error('Usage: node wasm/engine/smoke.mjs <model> <out.gcode> [threads] [--cancel-after-ms N] [--cancel-before] [--dump-config out.json] [--twice]');
        process.exit(1);
    }

    model = path.resolve(process.cwd(), positional[0]);
    outGcode = path.resolve(process.cwd(), positional[1]);
    if (positional.length >= 3) {
        threads = parseInt(positional[2], 10);
    }

    return { model, outGcode, threads, cancelAfterMs, dumpConfig, twice, cancelBefore };
}

function copyDirToFS(Module, srcDir, destDir) {
    if (!fs.existsSync(srcDir)) return;
    try {
        Module.FS.mkdirTree(destDir);
    } catch (e) {}
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
        const srcPath = path.join(srcDir, entry.name);
        const destPath = path.posix.join(destDir, entry.name);
        if (entry.isDirectory()) {
            copyDirToFS(Module, srcPath, destPath);
        } else {
            Module.FS.writeFile(destPath, fs.readFileSync(srcPath));
        }
    }
}

async function runOp(engine, op, args, { onPoll } = {}) {
    const jobId = engine.submit(op, JSON.stringify(args));
    while (true) {
        await new Promise(resolve => setTimeout(resolve, 16));
        if (onPoll) {
            onPoll(jobId);
        }
        const resStr = engine.poll(jobId);
        if (resStr !== "") {
            return JSON.parse(resStr);
        }
    }
}

async function main() {
    const opts = parseArgs();

    console.log(`[smoke] Initializing createOrcaEngine...`);
    const Module = await createOrcaEngine();
    const engine = new Module.Engine();

    console.log(`[smoke] Copying assets to MEMFS...`);
    copyDirToFS(Module, path.join(repoRoot, 'resources/info'), '/resources/info');

    Module.FS.mkdirTree('/data/system');
    Module.FS.writeFile('/data/system/OrcaFilamentLibrary.json',
        fs.readFileSync(path.join(repoRoot, 'resources/profiles/OrcaFilamentLibrary.json')));
    copyDirToFS(Module, path.join(repoRoot, 'resources/profiles/OrcaFilamentLibrary'), '/data/system/OrcaFilamentLibrary');

    Module.FS.writeFile('/data/system/Voron.json',
        fs.readFileSync(path.join(repoRoot, 'resources/profiles/Voron.json')));
    copyDirToFS(Module, path.join(repoRoot, 'resources/profiles/Voron'), '/data/system/Voron');

    const modelBasename = path.basename(opts.model);
    Module.FS.mkdirTree('/models');
    Module.FS.writeFile('/models/' + modelBasename, fs.readFileSync(opts.model));

    Module.FS.mkdirTree('/out');

    console.log(`[smoke] Calling init...`);
    let res = await runOp(engine, 'init', { resourcesDir: '/resources', dataDir: '/data' });
    if (!res.ok) throw new Error(`init failed: ${res.error}`);

    console.log(`[smoke] Calling loadVendors...`);
    res = await runOp(engine, 'loadVendors', {});
    if (!res.ok) throw new Error(`loadVendors failed: ${res.error}`);
    console.log(`[smoke] Loaded vendors: ${res.result.vendors.map(v => v.name).join(', ')}`);

    console.log(`[smoke] Calling selectPresets...`);
    res = await runOp(engine, 'selectPresets', {
        printer: "Voron 2.4 300 0.4 nozzle",
        process: "0.20mm Standard @Voron",
        filaments: ["Generic PLA @System"]
    });
    if (!res.ok) throw new Error(`selectPresets failed: ${res.error}`);
    console.log(`[smoke] Selected presets: printer="${res.result.printer}", process="${res.result.process}", filaments=${JSON.stringify(res.result.filaments)}`);

    if (opts.dumpConfig) {
        console.log(`[smoke] Dumping config to ${opts.dumpConfig}...`);
        const cfgRes = await runOp(engine, 'getConfig', {});
        if (!cfgRes.ok) throw new Error(`getConfig failed: ${cfgRes.error}`);
        fs.mkdirSync(path.dirname(path.resolve(process.cwd(), opts.dumpConfig)), { recursive: true });
        fs.writeFileSync(path.resolve(process.cwd(), opts.dumpConfig), JSON.stringify(cfgRes.result, null, 2));
        console.log(`[smoke] Config dumped (${Object.keys(cfgRes.result).length} keys).`);
    }

    console.log(`[smoke] Calling loadModel (/models/${modelBasename})...`);
    res = await runOp(engine, 'loadModel', { path: '/models/' + modelBasename });
    if (!res.ok) throw new Error(`loadModel failed: ${res.error}`);
    console.log(`[smoke] Loaded model: ${res.result.objects.length} object(s)`);

    console.log(`[smoke] Calling arrange...`);
    res = await runOp(engine, 'arrange', {});
    if (!res.ok) throw new Error(`arrange failed: ${res.error}`);

    const memfsGcodePath1 = '/out/plate_1.gcode';

    if (opts.cancelBefore) {
        console.log(`[smoke] Submitting slice with --cancel-before (threads=${opts.threads})...`);
        const cancelJobId = engine.submit('slice', JSON.stringify({ outPath: memfsGcodePath1, threads: opts.threads }));
        console.log(`[smoke] Calling cancel() right after submit (before polling)...`);
        engine.cancel();
        let cancelRes = null;
        while (true) {
            await new Promise(resolve => setTimeout(resolve, 16));
            const resStr = engine.poll(cancelJobId);
            if (resStr !== "") {
                cancelRes = JSON.parse(resStr);
                break;
            }
        }
        console.log(`[smoke] Cancel result received:`, JSON.stringify(cancelRes));
        if (!cancelRes.canceled) {
            console.error(`[smoke error] Expected canceled result, got:`, cancelRes);
            process.exit(1);
        }
        console.log(`[smoke] Now slicing again without cancel in the same run...`);
    }

    console.log(`[smoke] Calling slice (threads=${opts.threads})...`);

    let cancelTimer = null;
    let cancelTime = 0;
    if (opts.cancelAfterMs >= 0) {
        cancelTimer = setTimeout(() => {
            cancelTime = performance.now();
            console.log(`[smoke] Triggering cancel() after ${opts.cancelAfterMs} ms`);
            engine.cancel();
        }, opts.cancelAfterMs);
    }

    const tSliceStart = performance.now();
    res = await runOp(engine, 'slice', { outPath: memfsGcodePath1, threads: opts.threads }, {
        onPoll: () => {
            const progStr = engine.progress();
            if (progStr) {
                const prog = JSON.parse(progStr);
                if (prog.jobId > 0) {
                    // console.log(`[smoke] Progress: ${prog.percent}% ${prog.text}`);
                }
            }
        }
    });

    if (cancelTimer) {
        clearTimeout(cancelTimer);
    }

    if (opts.cancelAfterMs >= 0) {
        const cancelDurationMs = cancelTime > 0 ? (performance.now() - cancelTime) : 0;
        console.log(`[smoke] Cancel result received in ${cancelDurationMs.toFixed(1)} ms after cancel call:`, JSON.stringify(res));
        engine.delete();
        process.exit((res.canceled || res.ok) ? 0 : 1);
    }

    if (!res.ok) {
        throw new Error(`slice failed: ${res.error}`);
    }

    const tSliceEnd = performance.now();
    console.log(`[smoke] Slicing succeeded in ${(tSliceEnd - tSliceStart).toFixed(1)} ms`);
    console.log(`[smoke] Result stats: layers=${res.result.layers}, printTimeS=${res.result.printTimeS}, filamentMm=${res.result.filamentMm.toFixed(2)}, filamentG=${res.result.filamentG.toFixed(2)}`);

    const gcodeBytes = Module.FS.readFile(res.result.gcodePath);
    fs.mkdirSync(path.dirname(opts.outGcode), { recursive: true });
    fs.writeFileSync(opts.outGcode, gcodeBytes);
    console.log(`[smoke] Written ${gcodeBytes.length} bytes to ${opts.outGcode}`);

    if (opts.twice) {
        const memfsGcodePath2 = '/out/plate_2.gcode';
        console.log(`[smoke] Running second slice (--twice, threads=${opts.threads})...`);
        const tSlice2Start = performance.now();
        const res2 = await runOp(engine, 'slice', { outPath: memfsGcodePath2, threads: opts.threads });
        if (!res2.ok) throw new Error(`slice 2 failed: ${res2.error}`);
        const tSlice2End = performance.now();
        console.log(`[smoke] Slice 2 succeeded in ${(tSlice2End - tSlice2Start).toFixed(1)} ms`);

        const gcodeBytes2 = Module.FS.readFile(res2.result.gcodePath);
        const outGcode2 = opts.outGcode.endsWith('.gcode')
            ? opts.outGcode.slice(0, -6) + '_twice.gcode'
            : opts.outGcode + '.twice.gcode';
        fs.writeFileSync(outGcode2, gcodeBytes2);
        console.log(`[smoke] Written ${gcodeBytes2.length} bytes to ${outGcode2}`);
    }

    console.log(`[smoke] Done. Cleaning up engine.`);
    engine.delete();
    process.exit(0);
}

main().catch(err => {
    console.error(`[smoke error]`, err);
    process.exit(1);
});
