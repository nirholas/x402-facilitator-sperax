# @sperax/x402-facilitator

> Production x402 payment facilitator by [Sperax](https://sperax.io). Live at **[x402.sperax.io](https://x402.sperax.io)**

An [x402](https://github.com/coinbase/x402) payment facilitator that verifies and settles EIP-3009 USDC micropayments on Base, Arbitrum, and Ethereum.

Built with [Hono](https://hono.dev), [viem](https://viem.sh), and [Zod](https://zod.dev).

## Live Endpoints

| Endpoint | URL |
|---|---|
| Root | [x402.sperax.io](https://x402.sperax.io) |
| Health | [x402.sperax.io/health](https://x402.sperax.io/health) |
| Supported | [x402.sperax.io/supported](https://x402.sperax.io/supported) |
| Info | [x402.sperax.io/info](https://x402.sperax.io/info) |
| Balances | [x402.sperax.io/balances](https://x402.sperax.io/balances) |
| Metrics | [x402.sperax.io/metrics](https://x402.sperax.io/metrics) |
| Fees | [x402.sperax.io/fees](https://x402.sperax.io/fees) |
| Discovery | [x402.sperax.io/.well-known/x402](https://x402.sperax.io/.well-known/x402) |

**Facilitator Address**: [`0x40252CFDF8B20Ed757D61ff157719F33Ec332402`](https://basescan.org/address/0x40252CFDF8B20Ed757D61ff157719F33Ec332402)

## What is x402? (Plain English)

You know how some websites show a paywall? x402 is like that, but for APIs — and instead of credit cards, it uses crypto (USDC stablecoins).

Here's the simple version:

1. **Your app** tries to call a paid API
2. The API says **"pay me first"** (HTTP 402)
3. Your app **signs a payment** with its crypto wallet (no transaction yet — just a signature)
4. The API sends that signature to the **facilitator** (that's us!)
5. The facilitator **settles the payment on-chain** and tells the API "they paid"
6. The API **gives your app the data**

The best part? The **user never pays gas fees** — the facilitator covers those. The user only pays the actual price of the API call in USDC or USDs.

## How It Works

<p align="center">
  <img src="docs/x402-flow.svg" alt="x402 Payment Flow" width="800"/>
</p>

| Step | Action | Description |
|:---:|---|---|
| **1** | `GET /resource` | Client requests a paid resource |
| **2** | `402 Payment Required` | Server responds with payment requirements |
| **3** | EIP-712 signing | Client signs a `TransferWithAuthorization` ([EIP-3009](https://eips.ethereum.org/EIPS/eip-3009)) message |
| **4** | `GET /resource + X-PAYMENT` | Client retries with signed payment header |
| **5** | `POST /settle` | Resource server sends payment to facilitator |
| **6** | `transferWithAuthorization()` | Facilitator verifies signature and settles on-chain |
| **7** | `tx receipt` | Blockchain confirms the USDC transfer |
| **8** | `{ success, txHash }` | Facilitator returns settlement proof |
| **9** | `200 OK + resource` | Resource server grants access |

## Supported Chains

| Chain | Chain ID | USDC Address | Status |
|---|---|---|---|
| Base | `8453` | [`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`](https://basescan.org/token/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) | Active |
| Base Sepolia | `84532` | [`0x036CbD53842c5426634e7929541eC2318f3dCF7e`](https://sepolia.basescan.org/token/0x036CbD53842c5426634e7929541eC2318f3dCF7e) | Active |
| Arbitrum One | `42161` | [`0xaf88d065e77c8cC2239327C5EDb3A432268e5831`](https://arbiscan.io/token/0xaf88d065e77c8cC2239327C5EDb3A432268e5831) | Supported |
| Arbitrum Sepolia | `421614` | [`0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`](https://sepolia.arbiscan.io/token/0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d) | Supported |
| Ethereum | `1` | [`0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`](https://etherscan.io/token/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48) | Supported |

## Supported Tokens

| Token | Chain | Address | Settlement Scheme |
|---|---|---|---|
| **USDC** | Base, Base Sepolia, Arbitrum, Ethereum | See above | EIP-3009 `transferWithAuthorization` |
| **USDs** | Arbitrum | [`0xD74f5255D557944cf7Dd0E45FF521520002D5748`](https://arbiscan.io/token/0xD74f5255D557944cf7Dd0E45FF521520002D5748) | EIP-2612 `permit` + `transferFrom` |

### Settlement Schemes

The facilitator supports two gasless settlement mechanisms:

- **EIP-3009** (`transferWithAuthorization`): Single on-chain call. Used by Circle's USDC. The client signs a `TransferWithAuthorization` EIP-712 message and the facilitator submits it directly.
- **EIP-2612** (`permit` + `transferFrom`): Two-step flow. Used by USDs and other ERC20Permit tokens. The client signs a `Permit` EIP-712 message, the facilitator calls `permit()` to grant allowance, then `transferFrom()` to move the tokens.

Both schemes are fully gasless for the payer — the facilitator pays all gas fees.

### Future: SPA via Permit2

SPA is a standard ERC20 without native EIP-3009 or EIP-2612 support. Once [Permit2](https://github.com/Uniswap/permit2) integration is added, SPA (and any ERC-20) can be used for gasless x402 settlements. See the Ecosystem Contracts section below for SPA addresses.

## Sperax Ecosystem Contracts

| Contract | Chain | Address |
|---|---|---|
| **SPA Token** | Ethereum | [`0xB4A3B0Faf0Ab53df58001804DdA5Bfc6a3D59008`](https://etherscan.io/token/0xB4A3B0Faf0Ab53df58001804DdA5Bfc6a3D59008) |
| **SPA Token** | Arbitrum | [`0x5575552988A3A80504bBaeB1311674fCFd40aD4B`](https://arbiscan.io/token/0x5575552988A3A80504bBaeB1311674fCFd40aD4B) |
| **SPA Token** | BNB Chain | [`0x1A9Fd6eC3144Da3Dd6Ea13Ec1C25C58423a379b1`](https://bscscan.com/token/0x1A9Fd6eC3144Da3Dd6Ea13Ec1C25C58423a379b1) |
| **wSPA** | Ethereum | [`0x2a95FE4c7e64e09856989F9eA0b57B9AB5f770CB`](https://etherscan.io/token/0x2a95FE4c7e64e09856989F9eA0b57B9AB5f770CB) |
| **USDs** | Arbitrum | [`0xD74f5255D557944cf7Dd0E45FF521520002D5748`](https://arbiscan.io/token/0xD74f5255D557944cf7Dd0E45FF521520002D5748) |
| **xSPA** | Arbitrum | [`0x0966E72256d6055145902F72F9D3B6a194B9cCc3`](https://arbiscan.io/address/0x0966E72256d6055145902F72F9D3B6a194B9cCc3) |
| **veSPA** (proxy) | Arbitrum | [`0x2e2071180682Ce6C247B1eF93d382D509F5F6A17`](https://arbiscan.io/address/0x2e2071180682Ce6C247B1eF93d382D509F5F6A17) |
| **veSPA** (proxy) | Ethereum | [`0xbF82a3212e13b2d407D10f5107b5C8404dE7F403`](https://etherscan.io/address/0xbF82a3212e13b2d407D10f5107b5C8404dE7F403) |

## Quick Start

```bash
git clone https://github.com/Sperax/x402-facilitator.git
cd x402-facilitator
pnpm install
cp .env.example .env
# Edit .env with your private key and RPC URLs
pnpm dev
```

### Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start dev server with hot reload |
| `pnpm start` | Start production server |
| `pnpm build` | Build for production |
| `pnpm test` | Run tests (28 unit tests) |
| `pnpm typecheck` | Type-check without emitting |

## API Reference

### `GET /`

Root endpoint. Returns facilitator name and available endpoints.

```bash
curl https://x402.sperax.io/
```

```json
{
  "name": "SperaxOS x402 Facilitator",
  "docs": "https://github.com/Sperax/x402-facilitator",
  "endpoints": ["/verify", "/settle", "/health", "/info", "/supported"]
}
```

### `POST /verify`

Verify an EIP-3009 payment signature without settling on-chain. Used by resource servers to check if a payment is valid before granting access.

```bash
curl -X POST https://x402.sperax.io/verify \
  -H "Content-Type: application/json" \
  -d '{
    "paymentPayload": {
      "x402Version": 1,
      "chainId": 8453,
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "authorization": {
        "from": "0xSenderAddress",
        "to": "0xRecipientAddress",
        "value": "1000000",
        "validAfter": "0",
        "validBefore": "1735689600",
        "nonce": "0x..."
      },
      "signature": "0x..."
    },
    "paymentRequirements": {
      "chainId": 8453,
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "payTo": "0xRecipientAddress",
      "maxAmountRequired": "1000000"
    }
  }'
```

**200 OK**
```json
{ "isValid": true }
```

**400 Bad Request**
```json
{ "isValid": false, "error": "Insufficient authorization amount" }
```

### `POST /settle`

Verify and settle a payment on-chain by calling `transferWithAuthorization` on the USDC contract. This is the primary endpoint used by x402 resource servers.

```bash
curl -X POST https://x402.sperax.io/settle \
  -H "Content-Type: application/json" \
  -d '{
    "paymentPayload": { ... },
    "paymentRequirements": { ... }
  }'
```

**200 OK**
```json
{
  "success": true,
  "txHash": "0xabc123...",
  "transaction": "0xabc123...",
  "network": "base",
  "payer": "0xSenderAddress"
}
```

**402 Payment Required**
```json
{
  "success": false,
  "error": "Payment verification failed"
}
```

### `GET /health`

Per-chain RPC connectivity check. Returns live block numbers for each connected chain.

```bash
curl https://x402.sperax.io/health
```

```json
{
  "status": "ok",
  "version": "1.0.0",
  "uptime": 3600,
  "chains": [
    { "chainId": 8453, "network": "base", "connected": true, "blockNumber": 43885069 },
    { "chainId": 84532, "network": "base-sepolia", "connected": true, "blockNumber": 39395599 }
  ]
}
```

### `GET /supported`

Returns payment kinds supported by this facilitator. Required by the x402 SDK for discovery.

```bash
curl https://x402.sperax.io/supported
```

```json
{
  "kinds": [
    {
      "x402Version": 1,
      "scheme": "exact",
      "network": "base",
      "extra": { "name": "USDC", "decimals": 6, "token": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }
    }
  ]
}
```

### `GET /info`

Facilitator metadata: address, supported chains, tokens, and operator info.

```bash
curl https://x402.sperax.io/info
```

```json
{
  "name": "SperaxOS x402 Facilitator",
  "version": "1.0.0",
  "x402Version": 1,
  "facilitatorAddress": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
  "supportedChains": [
    {
      "chainId": 8453,
      "network": "base",
      "tokens": [{ "symbol": "USDC", "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "decimals": 6 }]
    }
  ],
  "operator": { "name": "SperaxOS", "url": "https://chat.sperax.io" }
}
```

### `GET /balances`

Facilitator wallet ETH + USDC balances on each enabled chain. Includes a `lowGas` warning when ETH drops below 0.001.

```bash
curl https://x402.sperax.io/balances
```

```json
{
  "facilitatorAddress": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
  "status": "ok",
  "chains": [
    {
      "chainId": 8453,
      "network": "base",
      "eth": { "balance": "0.005", "wei": "5000000000000000" },
      "usdc": { "balance": "0.0", "raw": "0" },
      "lowGas": false
    }
  ]
}
```

### `GET /metrics`

Verification and settlement counters, latency percentiles, uptime. Useful for monitoring dashboards.

```bash
curl https://x402.sperax.io/metrics
```

```json
{
  "timestamp": "2026-03-26T12:00:00.000Z",
  "uptime": 86400,
  "verify": {
    "requests": { "{\"valid\":\"true\"}": 42 },
    "errors": 0,
    "latency": { "avg": 12.5, "p99": 45, "count": 42 }
  },
  "settle": {
    "success": { "{\"chainId\":\"8453\"}": 10 },
    "failed": {},
    "rejected": 0,
    "latency": { "avg": 2100, "p99": 4500, "count": 10 }
  }
}
```

### `GET /fees`

Current gas prices and estimated settlement cost per chain.

```bash
curl https://x402.sperax.io/fees
```

```json
{
  "chains": [
    {
      "chainId": 8453,
      "network": "base",
      "gasPrice": "0.005 gwei",
      "estimatedSettlementCost": {
        "eth": "0.0000004",
        "wei": "400000000000",
        "gasUnits": "80000"
      }
    }
  ]
}
```

### `GET /status/:txHash`

Look up a settlement transaction by hash. Searches all enabled chains.

```bash
curl https://x402.sperax.io/status/0xabc123...
```

```json
{
  "chainId": 8453,
  "network": "base",
  "found": true,
  "status": "confirmed",
  "blockNumber": 43885069,
  "from": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
  "to": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "gasUsed": "65000",
  "explorerUrl": "https://basescan.org/tx/0xabc123..."
}
```

### `GET /.well-known/x402`

Standard x402 protocol discovery endpoint. Allows clients and crawlers to auto-discover this facilitator's capabilities, supported chains, and available endpoints.

```bash
curl https://x402.sperax.io/.well-known/x402
```

## Tutorials & Examples

### Example 1: Check if the Facilitator is Running

The simplest way to test — just hit the root URL:

```bash
curl https://x402.sperax.io/
```

You should see:
```json
{
  "name": "SperaxOS x402 Facilitator",
  "docs": "https://github.com/Sperax/x402-facilitator",
  "endpoints": ["/verify", "/settle", "/health", "/info", "/supported", ...]
}
```

### Example 2: Check Gas Balances (Is the Facilitator Funded?)

Before settling payments, the facilitator needs ETH for gas. Check if it's funded:

```bash
curl https://x402.sperax.io/balances
```

If you see `"lowGas": true` on any chain, the facilitator needs more ETH on that chain.

### Example 3: Build a Paid API with Express.js

Here's a complete example of a Node.js API that charges $0.01 per request using x402:

```ts
import express from "express";

const app = express();
const FACILITATOR_URL = "https://x402.sperax.io";
const MY_WALLET = "0xYourWalletAddress"; // where you receive payments

app.get("/premium-data", async (req, res) => {
  const paymentHeader = req.headers["x-payment"];

  // Step 1: No payment? Tell the client what to pay
  if (!paymentHeader) {
    return res.status(402).json({
      x402Version: 1,
      accepts: [{
        chainId: 8453,
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base
        payTo: MY_WALLET,
        maxAmountRequired: "10000", // $0.01 (USDC has 6 decimals)
      }],
      facilitatorUrl: FACILITATOR_URL,
    });
  }

  // Step 2: Client sent a payment — ask the facilitator to settle it
  const settleResponse = await fetch(`${FACILITATOR_URL}/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paymentPayload: JSON.parse(paymentHeader as string),
      paymentRequirements: {
        chainId: 8453,
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        payTo: MY_WALLET,
        maxAmountRequired: "10000",
      },
    }),
  });

  const result = await settleResponse.json();

  // Step 3: Payment settled? Serve the premium data
  if (result.success) {
    return res.json({
      data: "Here's your premium data!",
      paidWith: result.txHash,
    });
  }

  return res.status(402).json({ error: "Payment failed", reason: result.errorReason });
});

app.listen(3000, () => console.log("Paid API running on :3000"));
```

### Example 4: Use with the x402 SDK (Recommended)

The [x402 SDK](https://github.com/coinbase/x402) handles the client-side payment flow automatically:

```ts
import { createPaymentClient } from "@anthropic/x402-sdk";

// The SDK handles everything: 402 detection, signing, retrying with payment
const client = createPaymentClient({
  wallet: yourWallet, // viem wallet client
  facilitatorUrl: "https://x402.sperax.io",
});

// Just fetch like normal — the SDK intercepts 402s and pays automatically
const response = await client.fetch("https://api.example.com/premium-data");
const data = await response.json();
```

### Example 5: Monitor Your Facilitator

If you're running your own instance, here's how to monitor it:

```bash
# Check health of all chains
curl https://x402.sperax.io/health

# Check gas balances (fund the wallet if lowGas is true)
curl https://x402.sperax.io/balances

# Check settlement stats
curl https://x402.sperax.io/metrics

# Check current gas costs per chain
curl https://x402.sperax.io/fees

# Look up a specific settlement
curl https://x402.sperax.io/status/0xYourTxHash
```

### Example 6: AI Agent Autonomous Payments

AI agents on [SperaxOS](https://chat.sperax.io) can pay for APIs without human intervention:

```ts
// Agent discovers a paid API
const response = await fetch("https://api.example.com/data");

if (response.status === 402) {
  // Agent reads the payment requirements
  const requirements = await response.json();

  // Agent signs the payment with its own wallet
  const signature = await agentWallet.signTypedData(/* EIP-712 message */);

  // Agent retries with the signed payment attached
  const paidResponse = await fetch("https://api.example.com/data", {
    headers: { "X-PAYMENT": JSON.stringify(signedPayload) },
  });

  // Agent gets the data it needed
  const data = await paidResponse.json();
}
```

This is the foundation of **agent-to-agent commerce** — AI agents paying each other for services, data, and compute.

### FAQ

**Q: Do I need to run my own facilitator?**
No! You can use the public Sperax facilitator at `https://x402.sperax.io` for free. It's open to everyone.

**Q: What does it cost to use?**
The Sperax facilitator is **fee-free** — you only pay the USDC amount for the API call. The facilitator covers gas costs.

**Q: What tokens are supported?**
USDC (on Base, Arbitrum, Ethereum) and USDs (on Arbitrum). USDC uses EIP-3009, USDs uses EIP-2612 permit. SPA support is planned via Permit2.

**Q: How fast are settlements?**
Base and Arbitrum settle in ~2 seconds. Ethereum in ~12 seconds.

**Q: Is my money safe?**
Yes. The facilitator is **non-custodial** — it never holds your tokens. Payments go directly from the payer to the recipient via smart contract. The facilitator just submits the pre-signed transaction.

**Q: Can I run my own facilitator?**
Yes! Clone this repo, set your private key and RPC URLs, and deploy. See the Quick Start and Deployment sections below.

## Deployment

### Railway (recommended)

The repo includes `railway.json` for one-click deployment:

1. [Deploy from GitHub](https://railway.app/new) and select this repo
2. Set environment variables in the Railway dashboard
3. Add a custom domain (e.g., `x402.yourdomain.com`)
4. Railway handles SSL, health checks, and auto-deploys on push

### Docker

```bash
docker build -t x402-facilitator .
docker run -p 3402:3402 --env-file .env x402-facilitator
```

### Docker Compose

```bash
docker compose up -d
```

## Environment Variables

See [`.env.example`](.env.example) for all options.

### Required

| Variable | Description |
|---|---|
| `FACILITATOR_PRIVATE_KEY` | 32-byte hex private key (`0x...`). The wallet that submits settlement transactions. |
| `BASE_RPC_URL` | RPC endpoint for Base mainnet (enabled by default) |

### Optional — Additional Chains

| Variable | Description |
|---|---|
| `BASE_SEPOLIA_RPC_URL` | RPC endpoint for Base Sepolia testnet |
| `ARBITRUM_RPC_URL` | RPC endpoint for Arbitrum One |
| `ARBITRUM_SEPOLIA_RPC_URL` | RPC endpoint for Arbitrum Sepolia testnet |
| `ETHEREUM_RPC_URL` | RPC endpoint for Ethereum mainnet |

### Optional — Feature Flags

| Variable | Default | Description |
|---|---|---|
| `ENABLE_BASE` | `true` | Enable Base mainnet |
| `ENABLE_BASE_SEPOLIA` | `true` | Enable Base Sepolia |
| `ENABLE_ARBITRUM` | `false` | Enable Arbitrum One |
| `ENABLE_ARBITRUM_SEPOLIA` | `false` | Enable Arbitrum Sepolia |
| `ENABLE_ETHEREUM` | `false` | Enable Ethereum mainnet |

### Optional — Server Config

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3402` | Server port |
| `HOST` | `0.0.0.0` | Server host |
| `RATE_LIMIT_MAX` | `100` | Max requests per window per IP |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window (ms) |
| `CORS_ORIGINS` | `*` | Allowed CORS origins (comma-separated) |
| `LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error` |

The facilitator wallet needs ETH on each enabled chain to pay gas for `transferWithAuthorization` calls. The wallet does not custody user funds.

## Security

- **Non-custodial**: The facilitator wallet only needs ETH for gas. It never holds user USDC. Payments flow directly from sender to recipient via `transferWithAuthorization`.
- **EIP-712 verification**: All payment signatures are cryptographically verified against the sender's address before settlement.
- **Nonce protection**: Each authorization nonce is checked on-chain before submission to prevent replay attacks. In-flight nonces are tracked in memory to prevent concurrent double-settlement.
- **Rate limiting**: Configurable per-IP rate limiting via middleware.
- **Input validation**: All request bodies are validated with Zod schemas before processing.
- **Secure headers**: HSTS, X-Frame-Options, CSP, and other security headers via Hono middleware.

## Architecture

```
src/
├── index.ts                     # Hono server entry point
├── server.ts                    # Server factory
├── core/
│   ├── facilitator.ts           # Orchestrates verify + settle flow
│   ├── verifier.ts              # EIP-712 signature + requirements validation
│   ├── settler.ts               # On-chain transferWithAuthorization
│   └── nonce-store.ts           # LRU nonce dedup cache
├── config/
│   ├── chains.ts                # Chain configs (Base, Arbitrum, Ethereum)
│   ├── tokens.ts                # Token registry + EIP-712 domains
│   └── env.ts                   # Zod-validated environment
├── routes/
│   ├── verify.ts                # POST /verify
│   ├── settle.ts                # POST /settle
│   ├── health.ts                # GET /health
│   ├── info.ts                  # GET /info
│   ├── supported.ts             # GET /supported
│   ├── balances.ts              # GET /balances
│   ├── metrics.ts               # GET /metrics
│   ├── fees.ts                  # GET /fees
│   ├── status.ts                # GET /status/:txHash
│   └── well-known.ts            # GET /.well-known/x402
├── middleware/
│   ├── cors.ts                  # CORS configuration
│   ├── rateLimit.ts             # Per-IP rate limiting
│   ├── validate.ts              # Request validation schemas
│   └── x402-resource-server.ts  # x402 resource server middleware
├── types/
│   └── index.ts                 # TypeScript interfaces
└── utils/
    ├── logger.ts                # Structured JSON logging (pino)
    ├── metrics.ts               # Prometheus-style counters
    ├── errors.ts                # Error classes
    └── hex.ts                   # Hex utilities
```

## About

Built by [Sperax](https://sperax.io) for the x402 ecosystem.

- **SperaxOS**: [chat.sperax.io](https://chat.sperax.io) — AI Agent Workspace
- **Sperax dApp**: [app.sperax.io](https://app.sperax.io)
- **x402 Protocol**: [github.com/coinbase/x402](https://github.com/coinbase/x402)

## License

All rights reserved. See [LICENSE](LICENSE).
