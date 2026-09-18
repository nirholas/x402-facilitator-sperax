import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { formatEther } from 'viem';
import { z } from 'zod';
import { ARBITRUM_ONE, PAYMENT_ASSETS, requirementsExtra } from './assets.js';
import type { FacilitatorConfig } from './config.js';
import type { FacilitatorRuntime } from './facilitator.js';
import { mountDemo } from './demo.js';
import type { Logger } from './logger.js';
import { SettlementIndex } from './stats.js';

const VERSION = '2.0.0';

const requestSchema = z.object({
  x402Version: z.number().int().optional(),
  paymentPayload: z.object({ x402Version: z.number().int() }).passthrough(),
  paymentRequirements: z
    .object({
      scheme: z.string(),
      network: z.string(),
      asset: z.string(),
      amount: z.string(),
      payTo: z.string(),
    })
    .passthrough(),
});

type ParsedRequest = { paymentPayload: PaymentPayload; paymentRequirements: PaymentRequirements };

async function parseRequest(c: Context): Promise<ParsedRequest | { error: string }> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { error: 'invalid_json: request body must be JSON' };
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return { error: `invalid_request: ${issues}` };
  }
  return parsed.data as unknown as ParsedRequest;
}

/** Fixed-window per-client limiter for the two mutating endpoints. */
function rateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return async (c: Context, next: () => Promise<void>) => {
    const key = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'direct';
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      if (hits.size > 10_000) {
        for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
      }
    } else if (++entry.count > max) {
      c.header('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return c.json({ error: 'rate_limited' }, 429);
    }
    await next();
  };
}

export function createApp(runtime: FacilitatorRuntime, config: FacilitatorConfig, log: Logger): Hono {
  const { facilitator } = runtime;
  const app = new Hono();

  app.use('*', cors({ origin: config.corsOrigins.includes('*') ? '*' : config.corsOrigins }));
  app.use('/verify', bodyLimit({ maxSize: 64 * 1024 }), rateLimiter(config.rateLimitMax, config.rateLimitWindowMs));
  app.use('/settle', bodyLimit({ maxSize: 64 * 1024 }), rateLimiter(config.rateLimitMax, config.rateLimitWindowMs));

  app.get('/', (c) =>
    c.json({
      name: 'Sperax x402 facilitator',
      version: VERSION,
      x402Version: 2,
      signer: runtime.address,
      networks: runtime.networks,
      endpoints: ['GET /supported', 'GET /assets', 'POST /verify', 'POST /settle', 'GET /health', 'GET /ready', 'GET /stats', 'GET /demo', 'GET /openapi.json'],
    }),
  );

  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.get('/ready', async (c) => {
    const checks = await Promise.all(
      runtime.networks.map(async (network) => {
        const client = runtime.publicClients.get(network)!;
        try {
          const [block, balance] = await Promise.all([
            client.getBlockNumber(),
            client.getBalance({ address: runtime.address }),
          ]);
          return {
            network,
            ok: balance >= config.minGasBalanceWei,
            block: block.toString(),
            gasBalance: formatEther(balance),
            ...(balance < config.minGasBalanceWei ? { error: 'signer gas balance below MIN_GAS_BALANCE_WEI' } : {}),
          };
        } catch (err) {
          return { network, ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }),
    );
    const ready = checks.every((ch) => ch.ok);
    return c.json({ status: ready ? 'ready' : 'degraded', signer: runtime.address, checks }, ready ? 200 : 503);
  });

  app.get('/supported', (c) => c.json(facilitator.getSupported()));

  app.get('/assets', (c) =>
    c.json({
      assets: PAYMENT_ASSETS.filter((a) => runtime.networks.includes(a.network)).map((a) => ({
        network: a.network,
        asset: a.address,
        symbol: a.symbol,
        decimals: a.decimals,
        assetTransferMethod: a.assetTransferMethod,
        eip712: a.eip712,
        eip2612PermitFunctional: a.eip2612PermitFunctional,
        requirementsExtra: requirementsExtra(a),
        gasSponsoring: a.assetTransferMethod === 'permit2'
          ? a.eip2612PermitFunctional
            ? ['eip2612GasSponsoring', 'erc20ApprovalGasSponsoring']
            : ['erc20ApprovalGasSponsoring']
          : [],
      })),
    }),
  );

  app.post('/verify', async (c) => {
    const req = await parseRequest(c);
    if ('error' in req) return c.json({ isValid: false, invalidReason: req.error }, 400);
    try {
      return c.json(await facilitator.verify(req.paymentPayload, req.paymentRequirements));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith('No facilitator registered')) {
        return c.json({ isValid: false, invalidReason: `unsupported_scheme_or_network: ${message}` }, 400);
      }
      log.error('verify threw', { error: message });
      return c.json({ isValid: false, invalidReason: 'facilitator_error', invalidMessage: message }, 500);
    }
  });

  app.post('/settle', async (c) => {
    const req = await parseRequest(c);
    const network = 'error' in req ? '' : req.paymentRequirements.network;
    if ('error' in req) return c.json({ success: false, errorReason: req.error, transaction: '', network }, 400);
    try {
      return c.json(await facilitator.settle(req.paymentPayload, req.paymentRequirements));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith('Settlement aborted: ')) {
        return c.json({ success: false, errorReason: message.slice('Settlement aborted: '.length), transaction: '', network });
      }
      if (message.startsWith('No facilitator registered')) {
        return c.json({ success: false, errorReason: `unsupported_scheme_or_network: ${message}`, transaction: '', network }, 400);
      }
      log.error('settle threw', { error: message });
      return c.json({ success: false, errorReason: 'facilitator_error', errorMessage: message, transaction: '', network }, 500);
    }
  });

  const arbitrum = runtime.publicClients.get(ARBITRUM_ONE);
  if (arbitrum) {
    mountDemo(app, {
      facilitator,
      arbitrum,
      stats: new SettlementIndex(arbitrum, config.statsFromBlock, log),
      demo: config.demo,
      publicUrl: config.publicUrl,
      networks: runtime.networks,
      version: VERSION,
      contactEmail: config.contactEmail,
    });
  }

  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  return app;
}
