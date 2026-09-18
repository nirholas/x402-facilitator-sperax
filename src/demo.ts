import type { x402Facilitator } from '@x402/core/facilitator';
import { x402ResourceServer, type FacilitatorClient } from '@x402/core/server';
import type { SupportedResponse } from '@x402/core/types';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { declareErc20ApprovalGasSponsoringExtension } from '@x402/extensions';
import { paymentMiddleware } from '@x402/hono';
import type { Context, Hono } from 'hono';
import { formatUnits, parseAbi, type PublicClient } from 'viem';
import { ARBITRUM_ONE, USDS_ARBITRUM, usdsPrice } from './assets.js';
import { renderDemoPage } from './demo-page.js';
import type { SettlementIndex } from './stats.js';

const usdsReadAbi = parseAbi([
  'function totalSupply() view returns (uint256)',
  'function nonRebasingSupply() view returns (uint256)',
  'function paused() view returns (bool)',
]);

export interface DemoConfig {
  payTo: `0x${string}`;
  price: string;
}

/** Origin as the client saw it; Cloud Run and other proxies terminate TLS in front of us. */
function requestOrigin(c: Context): string {
  const url = new URL(c.req.url);
  const proto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() || url.protocol.replace(':', '');
  const host = c.req.header('x-forwarded-host') || c.req.header('host') || url.host;
  return `${proto}://${host}`;
}

/** Settle the demo route in-process instead of calling this service over HTTP. */
function localFacilitatorClient(facilitator: x402Facilitator): FacilitatorClient {
  return {
    verify: (payload, requirements) => facilitator.verify(payload, requirements),
    settle: (payload, requirements) => facilitator.settle(payload, requirements),
    // The facilitator reports registered CAIP-2 networks as plain strings; they are the same values.
    getSupported: async () => facilitator.getSupported() as SupportedResponse,
  };
}

/** A live read of USDs supply on Arbitrum One: the data the demo route sells. */
async function readUsdsSnapshot(client: PublicClient) {
  const [block, totalSupply, nonRebasingSupply, paused] = await Promise.all([
    client.getBlockNumber(),
    client.readContract({ address: USDS_ARBITRUM.address, abi: usdsReadAbi, functionName: 'totalSupply' }),
    client.readContract({ address: USDS_ARBITRUM.address, abi: usdsReadAbi, functionName: 'nonRebasingSupply' }),
    client.readContract({ address: USDS_ARBITRUM.address, abi: usdsReadAbi, functionName: 'paused' }),
  ]);
  const rebasing = totalSupply - nonRebasingSupply;
  return {
    asset: USDS_ARBITRUM.address,
    network: ARBITRUM_ONE,
    block: block.toString(),
    totalSupply: formatUnits(totalSupply, 18),
    rebasingSupply: formatUnits(rebasing, 18),
    nonRebasingSupply: formatUnits(nonRebasingSupply, 18),
    rebasingShare: totalSupply === 0n ? 0 : Number((rebasing * 10_000n) / totalSupply) / 100,
    paused,
    readAt: new Date().toISOString(),
  };
}

/**
 * Mount the public demo: a page anyone can open, live settlement stats, and
 * a real paid endpoint that any x402 client can buy with USDs.
 */
export function mountDemo(
  app: Hono,
  opts: {
    facilitator: x402Facilitator;
    arbitrum: PublicClient;
    stats: SettlementIndex;
    demo: DemoConfig | undefined;
    publicUrl: string | undefined;
  },
) {
  const { facilitator, arbitrum, stats, demo } = opts;

  app.get('/stats', async (c) => {
    try {
      await stats.refresh();
    } catch (err) {
      c.header('X-Stats-Stale', err instanceof Error ? err.message.slice(0, 120) : 'refresh failed');
    }
    c.header('Cache-Control', 'public, max-age=30');
    return c.json(stats.snapshot());
  });

  app.get('/demo', (c) =>
    c.html(
      renderDemoPage({
        baseUrl: opts.publicUrl ?? requestOrigin(c),
        demo: demo ? { price: demo.price, payTo: demo.payTo } : undefined,
      }),
    ),
  );

  if (!demo) return;

  const server = new x402ResourceServer(localFacilitatorClient(facilitator)).register(ARBITRUM_ONE, new ExactEvmScheme());
  app.use(
    '/demo/usds-snapshot',
    paymentMiddleware(
      {
        'GET /demo/usds-snapshot': {
          accepts: { scheme: 'exact', network: ARBITRUM_ONE, payTo: demo.payTo, price: usdsPrice(demo.price) },
          description: 'Live USDs supply snapshot on Arbitrum One, paid in USDs over x402',
          mimeType: 'application/json',
          extensions: { ...declareErc20ApprovalGasSponsoringExtension() },
        },
      },
      server,
    ),
  );
  app.get('/demo/usds-snapshot', async (c) => c.json(await readUsdsSnapshot(arbitrum)));
}
