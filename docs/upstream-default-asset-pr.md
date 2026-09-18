# Upstream PR: USDs as an x402 default asset

Description for the pull request from `nirholas/x402:feat/arbitrum-usds-default-asset` into `x402-foundation/x402`. Opened as https://github.com/x402-foundation/x402/pull/3513.

## Summary

Adds **Sperax USD (USDs)** on Arbitrum One (`eip155:42161`) as a second default asset, after USDC, in the TypeScript, Go and Python EVM default asset tables.

- Address `0xD74f5255D557944cf7Dd0E45FF521520002D5748`, 18 decimals, EIP-712 domain `name: "Sperax USD"`, `version: "1"` (matches the on-chain `DOMAIN_SEPARATOR`; `eip712Domain()` reverts on this proxy, so the values were derived from the separator).
- `assetTransferMethod: "permit2"`: USDs has no `transferWithAuthorization` / `receiveWithAuthorization` (EIP-3009 selectors are absent from the implementation bytecode).
- **No `supportsEip2612`**, on purpose. USDs exposes `permit()`, but it does not grant an allowance: the token keeps its own private `_allowances` mapping and does not override OpenZeppelin's `_approve`, so `permit()` consumes the nonce and writes to a slot `allowance()` never reads. Because `x402BasePermit2Proxy._executePermit` wraps the permit in try/catch, advertising EIP-2612 would make first payments fail late with "Insufficient allowance". Leaving the flag off makes clients use ERC-20 approval gas sponsoring, which works.
- USDC stays first, so bare `"$0.10"` on Arbitrum still resolves to USDC. `"$0.10 USDs"` resolves to USDs, and USDs is recognized by default spend controls.

Per DEFAULT_ASSETS.md, the paywall `decimals.ts` regeneration is not needed because the first Arbitrum entry is still 6-decimal USDC.

## Mainnet proof

A USDs payment settled through the canonical `x402ExactPermit2Proxy` on Arbitrum One with a facilitator built on `@x402/evm` 2.26 (exact + Permit2 + `erc20ApprovalGasSponsoring`):
https://arbiscan.io/tx/0x4b95dec2536a2911cab43f494d299d2093406b8f1576c84b4a7935106221d3f2

## Tests

- TypeScript: `test/unit/defaultAssets.test.ts` (12 passed), full `@x402/evm` unit suite 1123 passed.
- Go: new `default_assets_usds_test.go`; `go test ./mechanisms/evm/` passes.
- Python: `test_default_assets.py` 9 passed.

Changelog entries added for all three SDKs (changeset, changie, towncrier).
