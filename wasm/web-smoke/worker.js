importScripts('/wasm/build/web-smoke/orca_slice_driver.js');

if (globalThis.name !== 'em-pthread') {
    self.onmessage = async (e) => {
        if (!e.data || e.data.action !== 'slice') return;

        try {
            postMessage({ type: 'log', message: 'Worker received slice request.' });
            postMessage({ type: 'log', message: `Worker crossOriginIsolated: ${self.crossOriginIsolated}` });
            postMessage({ type: 'log', message: `Worker hardwareConcurrency: ${navigator.hardwareConcurrency}` });

            let finishResolve, finishReject;
            const finishPromise = new Promise((resolve, reject) => {
                finishResolve = resolve;
                finishReject = reject;
            });

            postMessage({ type: 'log', message: 'Initializing OrcaSlicer WebAssembly module...' });
            const orca = await createOrca({
                locateFile: (path, prefix) => {
                    if (path.endsWith('.wasm')) {
                        return '/wasm/build/web-smoke/' + path;
                    }
                    return (prefix || '') + path;
                },
                print: (text) => {
                    postMessage({ type: 'log', message: `[stdout] ${text}` });
                    if (typeof text === 'string' && text.startsWith('G-code size:')) {
                        finishResolve();
                    }
                },
                printErr: (text) => {
                    postMessage({ type: 'log', message: `[stderr] ${text}` });
                    if (typeof text === 'string' && text.includes('Error:')) {
                        finishReject(new Error(text));
                    }
                }
            });

            postMessage({ type: 'log', message: 'Module initialized. Fetching cube.obj and config JSON...' });
            const [cubeRes, cfgRes] = await Promise.all([
                fetch('/tests/data/20mm_cube.obj'),
                fetch('/wasm/spike/data/voron24_pla_020.json')
            ]);

            if (!cubeRes.ok) throw new Error(`HTTP error fetching /tests/data/20mm_cube.obj: ${cubeRes.status}`);
            if (!cfgRes.ok) throw new Error(`HTTP error fetching /wasm/spike/data/voron24_pla_020.json: ${cfgRes.status}`);

            const cubeBuffer = new Uint8Array(await cubeRes.arrayBuffer());
            const cfgBuffer = new Uint8Array(await cfgRes.arrayBuffer());

            postMessage({ type: 'log', message: `Fetched cube.obj (${cubeBuffer.byteLength} bytes) and cfg.json (${cfgBuffer.byteLength} bytes).` });

            orca.FS.writeFile('/cube.obj', cubeBuffer);
            orca.FS.writeFile('/cfg.json', cfgBuffer);

            postMessage({ type: 'log', message: 'Starting slicing engine via callMain...' });
            const t0 = performance.now();

            orca.callMain(["/cube.obj", "/out.gcode", "/cfg.json"]);

            await finishPromise;

            const t1 = performance.now();
            const totalTimeMs = Math.round(t1 - t0);

            postMessage({ type: 'log', message: `Slicing finished in ${totalTimeMs} ms.` });

            const gcodeBytes = orca.FS.readFile('/out.gcode');
            const gcodeSize = gcodeBytes.byteLength;
            const gcodeText = new TextDecoder().decode(gcodeBytes);
            const lines = gcodeText.split('\n');
            const first20Lines = lines.slice(0, 20).join('\n');

            let layerCount = 0;
            const layerMatch = gcodeText.match(/;\s*total layer number:\s*(\d+)/);
            if (layerMatch) {
                layerCount = parseInt(layerMatch[1], 10);
            }

            postMessage({
                type: 'done',
                size: gcodeSize,
                layerCount: layerCount,
                first20Lines: first20Lines,
                totalTimeMs: totalTimeMs,
                hardwareConcurrency: navigator.hardwareConcurrency,
                crossOriginIsolated: self.crossOriginIsolated
            });

        } catch (err) {
            postMessage({
                type: 'error',
                error: err.stack || err.message || String(err)
            });
        }
    };
}
