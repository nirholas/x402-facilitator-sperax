/**
 * Sell an API route for USDs on Arbitrum One.
 *
 *   FACILITATOR_URL=http://localhost:3402 PAY_TO=0xYourWallet pnpm example:seller
 *
 * Unpaid requests get a 402 whose offer tells x402 clients to pay 0.01 USDs
 * through Permit2, with this facilitator sponsoring the one-time approval.
 */
import { serve } from '@hono/node-server';
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { declareErc20ApprovalGasSponsoringExtension } from '@x402/extensions';
import { paymentMiddleware } from '@x402/hono';
import { Hono } from 'hono';
import { isAddress } from 'viem';
import { ARBITRUM_ONE, usdsPrice } from '../src/assets.js';

const facilitatorUrl = process.env.FACILITATOR_URL ?? 'http://localhost:3402';
const payTo = process.env.PAY_TO;
const port = Number(process.env.SELLER_PORT ?? 4021);

if (!payTo || !isAddress(payTo)) {
  console.error('Set PAY_TO to the Arbitrum address that should receive USDs.');
  process.exit(1);
}

/** The payment middleware loads its offers from the facilitator, so wait until it answers. */
async function waitForFacilitator(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${facilitatorUrl}/supported`)).ok) return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  console.error(`Facilitator at ${facilitatorUrl} did not answer /supported within ${timeoutMs / 1000}s.`);
  process.exit(1);
}
await waitForFacilitator();

const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitatorUrl })).register(
  ARBITRUM_ONE,
  new ExactEvmScheme(),
);

const app = new Hono();
app.use(
  paymentMiddleware(
    {
      'GET /quote': {
        accepts: { scheme: 'exact', network: ARBITRUM_ONE, payTo, price: usdsPrice('0.01') },
        description: 'A paid quote, settled in USDs',
        extensions: { ...declareErc20ApprovalGasSponsoringExtension() },
      },
    },
    resourceServer,
  ),
);
app.get('/quote', (c) => c.json({ quote: 'Paid with USDs over x402', at: new Date().toISOString() }));

serve({ fetch: app.fetch, port }, () => {
  console.log(`Seller on http://localhost:${port}/quote, paying ${payTo} through ${facilitatorUrl}`);
});
