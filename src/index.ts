import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createFacilitator } from './facilitator.js';
import { createLogger } from './logger.js';

const config = loadConfig();
const log = createLogger(config.logLevel);
const runtime = createFacilitator(config, log);
const app = createApp(runtime, config, log);

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  log.info('facilitator listening', { port: info.port, signer: runtime.address, networks: runtime.networks });
});

function shutdown(signal: string) {
  log.info('shutting down', { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
