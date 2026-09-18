# @sperax/x402-facilitator

An [x402](https://github.com/x402-foundation/x402) v2 facilitator that lets any HTTP API get paid in **Sperax USDs** on Arbitrum One, alongside USDC on Arbitrum and Base.

**Live:** https://sperax-x402-facilitator-lp642k3kpa-uc.a.run.app ([demo](https://sperax-x402-facilitator-lp642k3kpa-uc.a.run.app/demo), [stats](https://sperax-x402-facilitator-lp642k3kpa-uc.a.run.app/stats)). First mainnet USDs payment over x402: [0x4b95dec2...d3f2](https://arbiscan.io/tx/0x4b95dec2536a2911cab43f494d299d2093406b8f1576c84b4a7935106221d3f2).

A buyer only needs USDs. They do not need ETH, an account, or an API key: the facilitator verifies their signed payment, pays the gas, and settles on-chain.

Verification and settlement run on the upstream `@x402/core` and `@x402/evm` packages. This repo adds the USDs asset configuration, gas sponsoring for the buyer's first payment, and a guard against a defect in the USDs token described below.

## How a USDs payment works

USDs has no EIP-3009 (`transferWithAuthorization`), which is what "USDC over x402" uses. So USDs payments use the x402 `exact` scheme's **Permit2** path:

1. The seller answers an unpaid request with `402`, offering `exact` on `eip155:42161` with `asset` set to USDs and `extra: { assetTransferMethod: "permit2" }`.
2. The buyer signs a Permit2 witness transfer for exactly that amount to exactly that `payTo`.
3. **First payment only:** Permit2 needs a one-time USDs allowance. The buyer signs an `approve(Permit2, max)` transaction without broadcasting it, and the facilitator sends the buyer the exact gas that approve needs, then broadcasts it (the `erc20ApprovalGasSponsoring` extension).
4. The facilitator settles through the canonical x402 Permit2 proxy (`0x402085c248EeA27D92E8b30b2C58ed07f9E20001`), which moves the USDs straight from buyer to seller.

Later payments from the same buyer skip step 3.

### Why not EIP-2612 permit?

USDs inherits OpenZeppelin's `ERC20PermitUpgradeable` but keeps its own private `_allowances` mapping and never overrides `_approve`. So `permit()` checks the signature and consumes the nonce, but writes the allowance to a storage slot nothing reads, and the allowance stays 0. The Permit2 proxy calls `permit()` inside try/catch, so the failure is silent and the settlement later reverts with "Insufficient allowance".

This facilitator refuses a USDs payment that depends on an EIP-2612 permit with `invalidReason: eip2612_permit_nonfunctional` at verify time, before spending gas, unless the buyer has already approved Permit2. The fork test `confirms the reason: USDs permit() consumes the nonce but grants no allowance` reproduces the defect against the live contract.

The fix belongs in the token: override `_approve` so `permit()` writes USDs' own allowance mapping. Once that ships, set `eip2612PermitFunctional: true` for USDs in [`src/assets.ts`](src/assets.ts), and buyers get a fully signature-only first payment.

## Supported payments

| Network | Asset | Decimals | Transfer method | First-payment approval |
|---|---|---|---|---|
| Arbitrum One `eip155:42161` | USDs `0xD74f5255D557944cf7Dd0E45FF521520002D5748` | 18 | Permit2 | Sponsored `approve` transaction |
| Arbitrum One `eip155:42161` | USDC `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | 6 | EIP-3009 | None needed |
| Base `eip155:8453` (opt-in) | USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 | EIP-3009 | None needed |

## Run it

```bash
pnpm install
cp .env.example .env    # set FACILITATOR_PRIVATE_KEY, fund it with ETH on Arbitrum One
pnpm build && pnpm start
```

Or with Docker:

```bash
docker build -t sperax-x402-facilitator .
docker run -p 3402:3402 --env-file .env sperax-x402-facilitator
```

The container is stateless and listens on `PORT`, so it runs as-is on Cloud Run, Fly, Railway, or any container host. The signer wallet pays settlement gas and sponsored approvals: keep it funded and watch `/ready`.

## HTTP API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/supported` | x402 v2 supported kinds, extensions, and signer addresses |
| `POST` | `/verify` | `{ paymentPayload, paymentRequirements }` returns `{ isValid, invalidReason?, payer? }` |
| `POST` | `/settle` | `{ paymentPayload, paymentRequirements }` returns `{ success, transaction, network, payer?, errorReason? }` |
| `GET` | `/assets` | Assets this deployment settles, with the exact `extra` a seller must publish |
| `GET` | `/health` | Liveness |
| `GET` | `/ready` | RPC reachability and signer gas balance per network (503 when degraded) |
| `GET` | `/stats` | Every USDs payment settled over x402 on Arbitrum One (any facilitator), read from chain |
| `GET` | `/demo` | Public demo page: live settlement stats and copy-paste buyer code |
| `GET` | `/demo/usds-snapshot` | Paid demo route (when `DEMO_PAY_TO` is set): a live USDs supply snapshot for `DEMO_PRICE` USDs |
| `GET` | `/openapi.json` | OpenAPI 3.1 discovery document for x402 registries (x402scan): paid routes carry `x-payment-info`, free routes `security: []` |
| `GET` | `/` | Service metadata |

`/verify` and `/settle` are rate limited per client IP and capped at 64 KB per request body.

## Live demo and stats

`/demo` is a public page for anyone evaluating USDs payments. It shows how many USDs payments have settled over x402, the volume, and the latest transactions with Arbiscan links, all read directly from Arbitrum One (USDs transfers inside x402 Permit2 proxy settlements, by any facilitator). With `DEMO_PAY_TO` set, it also exposes `/demo/usds-snapshot`, a real paid route that sells a live USDs supply snapshot, and the page carries the copy-paste script to buy it.

## Registry listing

- **x402scan** reads `/openapi.json` first, then probes each paid route for its `402`. It only indexes **Base and Solana**, so a route offering only Arbitrum is rejected at registration. With `ENABLE_BASE=true` (and the signer funded with ETH on Base), the demo route also accepts USDC on Base after USDs, which makes it listable. `tests/unit/discovery.test.ts` checks the document against x402scan's rules and that the runtime `402` matches it.
- **agentic.market** is fed by Coinbase's Bazaar, which catalogs a route only after a paid call settles through the CDP facilitator. The demo route already declares the Bazaar discovery extension; listing it there needs a route whose seller settles through CDP.

## Sell an API for USDs

Sellers use the upstream middleware and price routes with this package's asset helpers. From [`examples/seller.ts`](examples/seller.ts):

```ts
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { declareErc20ApprovalGasSponsoringExtension } from '@x402/extensions';
import { paymentMiddleware } from '@x402/hono';
import { ARBITRUM_ONE, usdsPrice } from '@sperax/x402-facilitator/assets';

const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: FACILITATOR_URL }))
  .register(ARBITRUM_ONE, new ExactEvmScheme());

app.use(paymentMiddleware({
  'GET /quote': {
    accepts: { scheme: 'exact', network: ARBITRUM_ONE, payTo, price: usdsPrice('0.01') },
    extensions: { ...declareErc20ApprovalGasSponsoringExtension() },
  },
}, server));
```

`usdsPrice` converts the decimal amount to 18-decimal atomic units without floating point, and deliberately leaves `name` and `version` out of `extra`. The upstream client reads that as "do not sign an EIP-2612 permit" and uses approval sponsoring instead, which is the path that settles.

## Pay with USDs

USDs is not one of the upstream client's default assets, so a buyer opts in with a spend cap. From [`examples/buyer.ts`](examples/buyer.ts):

```ts
import { x402Client } from '@x402/core/client';
import { toClientEvmSigner } from '@x402/evm';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { wrapFetchWithPayment } from '@x402/fetch';
import { ARBITRUM_ONE, usdsSpendControl } from '@sperax/x402-facilitator/assets';

const client = new x402Client()
  .register(ARBITRUM_ONE, new ExactEvmScheme(toClientEvmSigner(account, publicClient), { rpcUrl }))
  .setSpendControls({ allowedAssets: [usdsSpendControl('0.10')] });

const res = await wrapFetchWithPayment(fetch, client)('https://api.example.com/quote');
```

Run the pair locally:

```bash
FACILITATOR_URL=http://localhost:3402 PAY_TO=0xYourWallet pnpm example:seller
BUYER_PRIVATE_KEY=0x... RESOURCE_URL=http://localhost:4021/quote pnpm example:buyer
```

The buyer example spends real USDs on Arbitrum One.

## USDs behaviour sellers should know

- **Rebasing.** USDs pays yield by rebasing ordinary wallets. Its transfer accounting truncates, so a wallet `payTo` can be credited 1 wei (1e-18 USDs) less than the payment amount. A contract `payTo` (a Safe, a treasury contract) is non-rebasing by default and receives the exact amount; a contract can opt in to yield by calling `rebaseOptIn()` on USDs.
- **Pausable.** The USDs owner can pause all transfers. While paused, settlement fails and the buyer is not charged.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `FACILITATOR_PRIVATE_KEY` | required | Settlement wallet key (0x-prefixed, 32 bytes) |
| `ENABLE_ARBITRUM` | `true` | Serve Arbitrum One (USDs, USDC) |
| `ARBITRUM_RPC_URL` | `https://arb1.arbitrum.io/rpc` | Arbitrum One RPC. Comma-separate several URLs to fail over in order; use a dedicated endpoint first in production |
| `ENABLE_BASE` | `false` | Serve Base (USDC) |
| `BASE_RPC_URL` | `https://mainnet.base.org` | Base RPC |
| `MAX_SPONSORED_GAS_WEI` | `100000000000000` | Most ETH sent to one buyer to cover their approve. Only `approve(Permit2, ...)` on a Permit2 asset is ever funded |
| `MIN_GAS_BALANCE_WEI` | `200000000000000` | `/ready` reports degraded below this signer balance |
| `CONFIRMATION_TIMEOUT_MS` | `60000` | Receipt wait before settlement is reported as pending |
| `PORT` / `HOST` | `3402` / `0.0.0.0` | Listen address |
| `CORS_ORIGINS` | `*` | Comma-separated allowed origins |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | `120` / `60000` | Per-IP limit on `/verify` and `/settle` |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`. Logs are one JSON object per line |
| `DEMO_PAY_TO` | unset | Enables the paid `/demo/usds-snapshot` route, paying this address |
| `DEMO_PRICE` | `0.001` | Price of the demo route in USDs |
| `STATS_FROM_BLOCK` | `506000000` | First Arbitrum One block `/stats` scans |
| `PUBLIC_URL` | derived from the request | Base URL shown on the demo page and in `/openapi.json` `servers` |
| `CONTACT_EMAIL` | unset | Published as `info.contact.email` in `/openapi.json`; registries use it to verify origin ownership |

## Tests

```bash
pnpm test        # unit tests: assets, sponsorship limits, the permit guard, HTTP API
pnpm test:fork   # end-to-end on an Arbitrum One fork (needs Foundry's anvil)
```

The fork suite runs a real seller, a real x402 buyer holding USDs and no ETH, and this facilitator against the live USDs, Permit2 and x402 proxy contracts. It covers the 402 offer, a first payment with sponsored approval, a repeat payment, the EIP-2612 refusal, and the token defect itself. Set `ARBITRUM_FORK_RPC_URL` to fork from your own RPC.

