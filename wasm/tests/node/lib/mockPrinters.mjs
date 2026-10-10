/**
 * Mock printers on 127.0.0.1 for the printer tests. They speak enough of the real protocols (Moonraker
 * JSON-RPC over websocket, OctoPrint and PrusaLink REST with their authentication) to exercise the
 * app's drivers and the gateway. Nothing here ever talks to a real printer.
 */
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { digestAuthorization } from '../../../app/gateway/policy.ts';

export const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** Parses a multipart/form-data body into { fields, files: { name: { filename, content } } }. */
export function parseMultipart(body, contentType) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType ?? '');
  const fields = {};
  const files = {};
  if (!boundary) return { fields, files };
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  let start = body.indexOf(delimiter);
  while (start !== -1) {
    const next = body.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    const part = body.subarray(start + delimiter.length + 2, next - 2); // skip CRLF before and after
    const headerEnd = part.indexOf('\r\n\r\n');
    const headers = part.subarray(0, headerEnd).toString();
    const content = part.subarray(headerEnd + 4);
    const name = /name="([^"]*)"/.exec(headers)?.[1];
    const filename = /filename="([^"]*)"/.exec(headers)?.[1];
    if (filename !== undefined) files[name] = { filename, content };
    else fields[name] = content.toString();
    start = next;
  }
  return { fields, files };
}

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

// ---------------------------------------------------------------------------------------------
// Moonraker (Klipper)
// ---------------------------------------------------------------------------------------------

export async function startMockMoonraker() {
  const status = {
    webhooks: { state: 'ready', state_message: 'Printer is ready' },
    print_stats: { state: 'standby', filename: '', print_duration: 0, message: '', info: { current_layer: null, total_layer: null } },
    virtual_sdcard: { progress: 0 },
    display_status: { progress: 0, message: null },
    toolhead: { position: [10, 20.5, 30.25, 0], extruder: 'extruder' },
    gcode_move: { speed_factor: 1, extrude_factor: 0.95 },
    fan: { speed: 0.5 },
    'fan_generic aux': { speed: 0.25 },
    extruder: { temperature: 210.2, target: 215 },
    extruder1: { temperature: 35, target: 0 },
    heater_bed: { temperature: 60.1, target: 60 },
    'heater_generic chamber': { temperature: 40, target: 45 }
  };
  const objectNames = [...Object.keys(status), 'gcode_macro T0', 'mcu', 'temperature_sensor mcu_temp', 'configfile'];
  const sockets = new Set();
  const mock = {
    uploads: [],
    rpcMethods: [],
    httpRequests: [],
    started: [],
    port: 0,
    push(patch) {
      for (const [name, fields] of Object.entries(patch)) status[name] = { ...status[name], ...fields };
      const message = JSON.stringify({ jsonrpc: '2.0', method: 'notify_status_update', params: [patch, Date.now() / 1000] });
      sockets.forEach((s) => s.send(message));
    },
    dropConnections: () => sockets.forEach((s) => s.terminate()),
    close: () => {
      sockets.forEach((s) => s.terminate());
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    }
  };

  const server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    mock.httpRequests.push({ method: req.method, url: req.url, headers: req.headers });
    const path = req.url.split('?')[0];
    if (path === '/server/info') {
      return json(res, 200, { result: { klippy_connected: true, klippy_state: 'ready', moonraker_version: 'v0.9.0-mock', components: [] } });
    }
    if (path === '/printer/info') return json(res, 200, { result: { state: 'ready', hostname: 'mockhost', software_version: 'v0.12.0-mock' } });
    if (path === '/server/files/upload' && req.method === 'POST') {
      const { fields, files } = parseMultipart(body, req.headers['content-type']);
      mock.uploads.push({ root: fields.root, print: fields.print === 'true', filename: files.file?.filename, content: files.file?.content });
      if (fields.print === 'true') {
        mock.push({ print_stats: { state: 'printing', filename: files.file.filename } });
        mock.started.push(files.file.filename);
      }
      return json(res, 201, { result: { item: { path: files.file?.filename, root: fields.root }, print_started: fields.print === 'true' } });
    }
    if (path === '/webcam/') {
      res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=frame' });
      return res.end('--frame\r\n');
    }
    res.writeHead(404);
    res.end('not found');
  });

  const wss = new WebSocketServer({ server, path: '/websocket' });
  wss.on('connection', (ws) => {
    sockets.add(ws);
    ws.on('close', () => sockets.delete(ws));
    ws.on('message', (data) => {
      const { method, params, id } = JSON.parse(data.toString());
      mock.rpcMethods.push(method);
      const reply = (result) => ws.send(JSON.stringify({ jsonrpc: '2.0', result, id }));
      switch (method) {
        case 'server.connection.identify': return reply({ connection_id: 1 });
        case 'printer.objects.list': return reply({ objects: objectNames });
        case 'printer.objects.subscribe': {
          const wanted = Object.keys(params.objects ?? {});
          return reply({ eventtime: 1, status: Object.fromEntries(wanted.filter((n) => status[n]).map((n) => [n, status[n]])) });
        }
        case 'server.webcams.list':
          return reply({ webcams: [
            { name: 'Nozzle cam', enabled: true, service: 'mjpegstreamer', stream_url: '/webcam/?action=stream', snapshot_url: '/webcam/?action=snapshot' },
            { name: 'Screen', enabled: true, service: 'iframe', stream_url: '/screen/' },
            { name: 'Off', enabled: false, service: 'mjpegstreamer', stream_url: '/off/' }
          ] });
        case 'server.files.list':
          return reply([{ path: 'old.gcode', modified: 1000, size: 10 }, { path: 'new.gcode', modified: 2000, size: 2048 }]);
        case 'printer.info': return reply({ state: 'ready', hostname: 'mockhost', software_version: 'v0.12.0-mock' });
        default:
          return ws.send(JSON.stringify({ jsonrpc: '2.0', error: { code: -32601, message: `unknown ${method}` }, id }));
      }
    });
  });
  mock.port = await listen(server);
  return mock;
}

// ---------------------------------------------------------------------------------------------
// OctoPrint
// ---------------------------------------------------------------------------------------------

export async function startMockOctoPrint({ apiKey = 'KEY' } = {}) {
  const mock = { uploads: [], port: 0, printing: false, close: () => { server.closeAllConnections(); return new Promise((r) => server.close(r)); } };
  const server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    if (req.headers['x-api-key'] !== apiKey) return json(res, 403, { error: 'Invalid API key' });
    const path = req.url.split('?')[0];
    if (path === '/api/version') return json(res, 200, { api: '0.1', server: '1.10.0', text: 'OctoPrint 1.10.0' });
    if (path === '/api/printer') {
      return json(res, 200, {
        state: { text: mock.printing ? 'Printing' : 'Operational', flags: { operational: true, printing: mock.printing, paused: false, ready: !mock.printing } },
        temperature: { tool0: { actual: 205.5, target: 210 }, tool1: { actual: 30, target: 0 }, bed: { actual: 58, target: 60 } }
      });
    }
    if (path === '/api/job') {
      return json(res, 200, mock.printing
        ? { state: 'Printing', job: { file: { name: 'cube.gcode' } }, progress: { completion: 42.5, printTime: 300, printTimeLeft: 400 } }
        : { state: 'Operational', job: { file: { name: null } }, progress: { completion: null, printTime: null, printTimeLeft: null } });
    }
    if (path === '/api/files/local' && req.method === 'POST') {
      const { fields, files } = parseMultipart(body, req.headers['content-type']);
      mock.uploads.push({ select: fields.select, print: fields.print === 'true', filename: files.file?.filename, content: files.file?.content });
      if (fields.print === 'true') mock.printing = true;
      return json(res, 201, { done: true });
    }
    res.writeHead(404);
    res.end();
  });
  mock.port = await listen(server);
  return mock;
}

// ---------------------------------------------------------------------------------------------
// PrusaLink (HTTP Digest, /api/v1)
// ---------------------------------------------------------------------------------------------

export async function startMockPrusaLink({ user = 'maker', password = 'secret' } = {}) {
  const challenge = { realm: 'Printer API', nonce: 'nonce123', qop: 'auth' };
  const mock = { uploads: [], digestRequests: 0, port: 0, close: () => { server.closeAllConnections(); return new Promise((r) => server.close(r)); } };
  const server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    const auth = req.headers.authorization;
    const unauthorized = () => {
      res.writeHead(401, { 'www-authenticate': `Digest realm="${challenge.realm}", qop="auth", nonce="${challenge.nonce}"` });
      res.end();
    };
    if (!auth) return unauthorized();
    const fields = Object.fromEntries([...auth.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)].map((m) => [m[1], m[2] ?? m[3]]));
    const expected = digestAuthorization(challenge, user, password, req.method, req.url, parseInt(fields.nc, 16), fields.cnonce);
    if (expected !== auth) return unauthorized();
    mock.digestRequests++;

    const path = req.url.split('?')[0];
    if (path === '/api/version') return json(res, 200, { api: '2.0.0', server: '2.1.2', text: 'PrusaLink MK4' });
    if (path === '/api/v1/status') {
      return json(res, 200, {
        printer: { state: 'PRINTING', temp_nozzle: 214.8, target_nozzle: 215, temp_bed: 59.9, target_bed: 60, axis_x: 1.5, axis_y: 2.5, axis_z: 3.5, flow: 100, speed: 120 },
        job: { id: 7, progress: 42, time_remaining: 600, time_printing: 300 }
      });
    }
    if (path === '/api/v1/job') return json(res, 200, { id: 7, state: 'PRINTING', file: { name: 'CUBE~1.GCO', display_name: 'cube.gcode' } });
    if (path === '/api/v1/storage') return json(res, 200, { storage_list: [{ path: '/usb/', name: 'usb', available: true, read_only: false }] });
    if (path.startsWith('/api/v1/files/') && req.method === 'PUT') {
      mock.uploads.push({ path, printAfter: req.headers['print-after-upload'], overwrite: req.headers.overwrite, contentType: req.headers['content-type'], content: body });
      return json(res, 201, {});
    }
    res.writeHead(404);
    res.end();
  });
  mock.port = await listen(server);
  return mock;
}

// ---------------------------------------------------------------------------------------------
// Flashforge
// ---------------------------------------------------------------------------------------------

export async function startMockFlashforge({ serialNumber = 'FF123', checkCode = 'CODE' } = {}) {
  const mock = { uploads: [], port: 0, close: () => { server.closeAllConnections(); return new Promise((r) => server.close(r)); } };
  const server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    const path = req.url.split('?')[0];

    if (path === '/detail' && req.method === 'POST') {
      const payload = JSON.parse(body.toString());
      if (payload.serialNumber !== serialNumber || payload.checkCode !== checkCode) {
        return json(res, 200, { err: 1, msg: 'Invalid credentials' });
      }
      return json(res, 200, {
        code: 0,
        detail: {
          matlStationInfo: {
            slotInfos: [
              { slotId: 1, hasFilament: 1, materialName: "PLA", materialColor: "FF0000" },
              { slotId: 2, hasFilament: 0 }
            ]
          }
        }
      });
    }

    if (path === '/uploadGcode' && req.method === 'POST') {
      if (req.headers['serialnumber'] !== serialNumber || req.headers['checkcode'] !== checkCode) {
        return json(res, 200, { err: 1, msg: 'Invalid credentials' });
      }
      const { fields, files } = parseMultipart(body, req.headers['content-type']);
      mock.uploads.push({ printNow: req.headers['printnow'] === 'true', filename: files.gcodeFile?.filename, content: files.gcodeFile?.content });
      return json(res, 200, { code: 0, msg: 'Upload success' });
    }

    res.writeHead(404);
    res.end();
  });
  mock.port = await listen(server);
  return mock;
}
