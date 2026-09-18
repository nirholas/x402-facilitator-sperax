# Operations: the live Sperax x402 facilitator

How the production facilitator at https://x402.sperax.io is deployed, what it is connected to, and how to run it. Facts are as of 2026-09-18.

## At a glance

| | |
|---|---|
| Public URL | https://x402.sperax.io |
| Demo page | https://x402.sperax.io/demo |
| Discovery document | https://x402.sperax.io/openapi.json |
| Health | https://x402.sperax.io/ready (per-network RPC and signer gas) |
| Networks | Arbitrum One `eip155:42161` (USDs via Permit2, USDC via EIP-3009), Base `eip155:8453` (USDC via EIP-3009) |
| Signer wallet | `0x42FfaFb149655407AAFD63628275fce64232EE21` (pays settlement gas and sponsored approvals on both chains) |
| First mainnet USDs payment over x402 | [0x4b95dec2...d3f2](https://arbiscan.io/tx/0x4b95dec2536a2911cab43f494d299d2093406b8f1576c84b4a7935106221d3f2) (0.001 USDs for `/demo/usds-snapshot`, settled through the canonical x402 Permit2 proxy) |

## Hosting

- **Google Cloud Run** service `sperax-x402-facilitator`, project `aerial-vehicle-466722-p5`, region `us-central1`.
- One instance (`min-instances 1`, `max-instances 1`). Pending settlements are tracked in memory and a single signer keeps nonces sequential; raise the instance count only after moving the pending-settlement store to shared storage.
- Image: `us-central1-docker.pkg.dev/aerial-vehicle-466722-p5/containers/sperax-x402-facilitator:<git short sha>`, built on Cloud Build by [`deploy/cloud-run.sh`](../deploy/cloud-run.sh) with the build service account `three-ws-build@`, running as `three-ws@`.
- The signer key is **never** in env files or the image: Cloud Run mounts it from Secret Manager secret `sperax-x402-facilitator-key` as `FACILITATOR_PRIVATE_KEY`.
- Runtime settings on the service: `ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc`, `ENABLE_BASE=true`, `BASE_RPC_URL=https://mainnet.base.org`, `DEMO_PAY_TO` (the signer wallet), `LOG_LEVEL=info`, `CONFIRMATION_TIMEOUT_MS=60000`. `--update-env-vars` merges, so a redeploy keeps these.

## Domain

`x402.sperax.io` is a **Cloud Run domain mapping** with a Google-managed certificate.

- `sperax.io` is verified in Google Search Console (DNS TXT record added through Cloudflare's one-click flow). Do not remove the `google-site-verification` TXT record at the zone apex, or the mapping loses its verification.
- The sperax.io DNS zone is in the Cloudflare account **Engineering_team@sperax.io**. The record is:

  | Type | Name | Target | Proxy |
  |---|---|---|---|
  | CNAME | `x402` | `ghs.googlehosted.com` | DNS only (grey cloud) |

  Keep it DNS only. A proxied (orange cloud) record hides it from Google and certificate renewal fails.
- The domain previously pointed at a Railway app (`bxx3kffr.up.railway.app`) that no longer exists.

## Registry listings

### x402scan

- **Listed** on 2026-09-18: 1 paid route (`GET /demo/usds-snapshot`, $0.001) and 4 free routes, 0 failures.
- x402scan reads `/openapi.json`, then probes each paid route for its 402. It only indexes **Base and Solana**, so the paid route offers USDC on Base after USDs on Arbitrum. Payments settled on Arbitrum are not counted in x402scan's volume; `/stats` and `/demo` here count them.
- Re-register after adding or changing paid routes:

  ```bash
  REGISTRAR_PRIVATE_KEY=0x... pnpm register:x402scan https://x402.sperax.io
  ```

  The wallet only signs a Sign-In-With-X login message; no funds move. Setting `CONTACT_EMAIL` publishes `info.contact.email`, which x402scan uses for ownership verification and the merchant page.

### agentic.market (Coinbase Bazaar)

Not listed yet. agentic.market is fed by Coinbase's Bazaar, which catalogs a route only after a paid call settles through the **CDP facilitator** (there is no submission form). The demo route already declares the Bazaar discovery extension; listing needs a route whose seller settles through CDP, which needs a Sperax CDP API key.

### Upstream x402 SDKs

Branch [`nirholas/x402:feat/arbitrum-usds-default-asset`](https://github.com/nirholas/x402/tree/feat/arbitrum-usds-default-asset) adds USDs on Arbitrum One as a Permit2 default asset in the TypeScript, Go and Python SDKs, so every x402 client recognizes USDs without a manual spend-control opt-in. Tests pass in all three SDKs. Opened upstream as [x402-foundation/x402#3513](https://github.com/x402-foundation/x402/pull/3513); its description cites the mainnet settlement above.

## Wallets and funding

| Wallet | Role | Funds |
|---|---|---|
| `0x42FfaFb149655407AAFD63628275fce64232EE21` | Facilitator signer and demo payee | ETH on Arbitrum One and Base for gas; receives demo payments |
| `0x562435c6f3853D742F9F1FbE6f5AEc414eE7721F` | Test buyer | USDs on Arbitrum One |

Keys live in Secret Manager (`sperax-x402-facilitator-key`, `sperax-x402-test-buyer-key`). `/ready` returns 503 when the signer's gas on any enabled network drops below `MIN_GAS_BALANCE_WEI` (0.0002 ETH by default); top it up before that. Each settlement costs a few cents of gas at most on either chain; a sponsored first-time approval adds about 0.00007 ETH on Arbitrum.

## Runbook

| Task | Command |
|---|---|
| Build and deploy | `DEMO_PAY_TO=0x42FfaFb149655407AAFD63628275fce64232EE21 ./deploy/cloud-run.sh` |
| Deploy the last built image | `SKIP_BUILD=1 DEMO_PAY_TO=... ./deploy/cloud-run.sh` |
| Change one setting | `gcloud run services update sperax-x402-facilitator --region us-central1 --project aerial-vehicle-466722-p5 --update-env-vars KEY=VALUE` |
| Health | `curl https://x402.sperax.io/ready` |
| Logs | `gcloud logging read 'resource.type="cloud_run_revision" resource.labels.service_name="sperax-x402-facilitator"' --project aerial-vehicle-466722-p5 --freshness=1h` |
| Domain and certificate state | `gcloud beta run domain-mappings describe --domain x402.sperax.io --region us-central1 --project aerial-vehicle-466722-p5` |
| Verify end to end locally | `pnpm test && pnpm test:fork` |

Logs are one JSON object per line: `verify`, `settle` (with transaction hash), `sponsored approve gas`, and `payment rejected before chain interaction` (the USDs permit guard).
