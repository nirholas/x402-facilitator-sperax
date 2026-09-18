import type { x402Facilitator } from '@x402/core/facilitator';
import { x402ResourceServer, type FacilitatorClient } from '@x402/core/server';
import type { PaymentOption } from '@x402/core/http';
import type { Network, SupportedResponse } from '@x402/core/types';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { declareErc20ApprovalGasSponsoringExtension } from '@x402/extensions';
import { bazaarResourceServerExtension, declareDiscoveryExtension } from '@x402/extensions/bazaar';
import { paymentMiddleware } from '@x402/hono';
import type { Context, Hono } from 'hono';
import { formatUnits, parseAbi, type PublicClient } from 'viem';
import { ARBITRUM_ONE, BASE, USDC_ARBITRUM, USDC_BASE, USDS_ARBITRUM, priceIn, usdsPrice } from './assets.js';
import { renderDemoPage } from './demo-page.js';
import { SNAPSHOT_OUTPUT_EXAMPLE, SNAPSHOT_OUTPUT_SCHEMA, buildOpenApi } from './openapi.js';
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
    networks: string[];
    version: string;
    contactEmail: string | undefined;
  },
) {
  const { facilitator, arbitrum, stats, demo } = opts;
  // USDs on Arbitrum is always offered first; USDC on Base is added when this
  // deployment settles Base, which also makes the route listable on registries
  // that index Base only.
  const demoNetworks = (demo ? [ARBITRUM_ONE, ...(opts.networks.includes(BASE) ? [BASE] : [])] : []) as Network[];

  app.get('/openapi.json', (c) => {
    c.header('Cache-Control', 'public, max-age=300');
    return c.json(
      buildOpenApi({
        baseUrl: opts.publicUrl ?? requestOrigin(c),
        version: opts.version,
        contactEmail: opts.contactEmail,
        demo: demo ? { price: demo.price, networks: demoNetworks } : undefined,
      }),
    );
  });

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

  const server = new x402ResourceServer(localFacilitatorClient(facilitator));
  for (const network of demoNetworks) server.register(network, new ExactEvmScheme());
  server.registerExtension(bazaarResourceServerExtension);
  // USDs first (the asset this service exists for), then USDC on Arbitrum,
  // then USDC on Base when Base is enabled.
  const accepts: PaymentOption[] = [
    { scheme: 'exact', network: ARBITRUM_ONE as Network, payTo: demo.payTo, price: usdsPrice(demo.price) },
    { scheme: 'exact', network: ARBITRUM_ONE as Network, payTo: demo.payTo, price: priceIn(USDC_ARBITRUM, demo.price) },
    ...(demoNetworks.includes(BASE as Network)
      ? [{ scheme: 'exact', network: BASE as Network, payTo: demo.payTo, price: priceIn(USDC_BASE, demo.price) }]
      : []),
  ];
  app.use(
    '/demo/usds-snapshot',
    paymentMiddleware(
      {
        'GET /demo/usds-snapshot': {
          accepts,
          description:
            'Live Sperax USD (USDs) supply on Arbitrum One: total supply, rebasing (auto-yield) versus non-rebasing supply, the share earning yield, and pause state.',
          mimeType: 'application/json',
          extensions: {
            ...declareErc20ApprovalGasSponsoringExtension(),
            ...declareDiscoveryExtension({
              output: { example: SNAPSHOT_OUTPUT_EXAMPLE, schema: SNAPSHOT_OUTPUT_SCHEMA as unknown as Record<string, unknown> },
            }),
          },
        },
      },
      server,
    ),
  );
  app.get('/demo/usds-snapshot', async (c) => c.json(await readUsdsSnapshot(arbitrum)));
}
