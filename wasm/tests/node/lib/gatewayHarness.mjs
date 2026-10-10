import http from 'node:http';
import { printerGatewayPlugin } from '../../../app/printerGateway.ts';

export const listen = (server, host = '127.0.0.1') =>
  new Promise((resolve) => server.listen(0, host, () => resolve(server.address().port)));
export const close = (server) => new Promise((resolve) => server.close(() => resolve()));
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs the gateway plugin inside a bare http server, the way Vite does (middleware plus upgrade listener). */
export async function startGateway(options) {
  const stack = [];
  const server = http.createServer((req, res) => {
    let i = 0;
    const next = () => (i < stack.length ? stack[i++](req, res, next) : (res.statusCode = 404, res.end('not found')));
    next();
  });
  printerGatewayPlugin(options).configureServer({ middlewares: { use: (fn) => stack.push(fn) }, httpServer: server });
  const port = await listen(server);
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}`,
    close: () => {
      server.closeAllConnections();
      return close(server);
    }
  };
}
