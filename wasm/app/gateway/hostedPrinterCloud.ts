/** Hosted cloud dispatch only; deliberately excludes the local/LAN gateway and listeners. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleCrealityCloudRequest } from './crealityCloud.ts';
import { handlePrusaConnectRequest } from './prusaConnect.ts';
import { handleBambuCloudApi } from './bambuCloud.ts';
import { handleSnapmakerCloudRequest } from './snapmakerCloud.ts';
import { createSnapmakerMonitor } from './snapmakerMonitor.ts';
import type { Duplex } from 'node:stream';

export function createHostedPrinterCloudBridge(cloud: string, publicOrigin?: string) {
  const services = cloud.split(',').map(id => id.trim().toLowerCase())
    .filter(id => id === 'prusa-connect' || id === 'creality-cloud' || id === 'bambu-cloud' || id === 'snapmaker-cloud');
  const options = { cloud: services.join(',') };
  const monitor = createSnapmakerMonitor({ ...options, snapmakerMonitorOrigin: publicOrigin });
  return {
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
      // Hosted callers must supply a configured origin; never infer it from the request.
      if (!publicOrigin) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return true; }
      return monitor.handleUpgrade(req, socket, head);
    },
    async handle(req: IncomingMessage, res: ServerResponse, pathname: string) {
      if (pathname === '/_printer/status' && req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ enabled: services.length > 0, mode: 'cloud', readOnly: false, cloud: services }));
      } else if (pathname.startsWith('/_printer/prusa-connect/')) {
        await handlePrusaConnectRequest(req, res, req.url ?? pathname, options);
      } else if (pathname.startsWith('/_printer/creality-cloud/')) {
        await handleCrealityCloudRequest(req, res, req.url ?? pathname, options);
      } else if (pathname.startsWith('/_printer/snapmaker-cloud/')) {
        await handleSnapmakerCloudRequest(req, res, req.url ?? pathname, options);
      } else if (pathname.startsWith('/_printer/bambu-cloud/api/')) {
        await handleBambuCloudApi(req, res, '/' + pathname.slice('/_printer/bambu-cloud/api/'.length), options);
      } else {
        res.writeHead(404);
        res.end('Unknown printer cloud route.');
      }
    }
  };
}
