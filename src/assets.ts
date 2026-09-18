/**
 * Payment asset registry.
 *
 * Sellers import this module (`@sperax/x402-facilitator/assets`) to price
 * routes in an asset this facilitator settles, and the facilitator uses it to
 * apply asset-specific rules.
 */
import type { SpendControlAsset } from '@x402/core/client';
import type { AssetAmount, Network } from '@x402/core/types';
import { getAddress, parseUnits } from 'viem';

export const ARBITRUM_ONE = 'eip155:42161' satisfies Network;
export const BASE = 'eip155:8453' satisfies Network;

export type AssetTransferMethod = 'eip3009' | 'permit2';

export interface PaymentAsset {
  network: Network;
  address: `0x${string}`;
  symbol: string;
  decimals: number;
  /** EIP-712 domain of the token contract, matched against its DOMAIN_SEPARATOR. */
  eip712: { name: string; version: string };
  /** How the buyer authorizes the transfer under the x402 `exact` scheme. */
  assetTransferMethod: AssetTransferMethod;
  /**
   * Whether the token's EIP-2612 `permit()` actually grants an allowance.
   *
   * USDs exposes `permit()` and it consumes the nonce, but the allowance it
   * writes lives in OpenZeppelin's storage while USDs reads allowances from
   * its own private mapping, so the approval never takes effect. Until the
   * token is upgraded, Permit2 approval must come from a real `approve`
   * transaction: sent by the buyer, or sponsored by this facilitator through
   * the `erc20ApprovalGasSponsoring` extension.
   */
  eip2612PermitFunctional: boolean;
}

/** Sperax USD on Arbitrum One: yield-bearing, 18 decimals, no EIP-3009. */
export const USDS_ARBITRUM: PaymentAsset = {
  network: ARBITRUM_ONE,
  address: '0xD74f5255D557944cf7Dd0E45FF521520002D5748',
  symbol: 'USDs',
  decimals: 18,
  eip712: { name: 'Sperax USD', version: '1' },
  assetTransferMethod: 'permit2',
  eip2612PermitFunctional: false,
};

export const USDC_ARBITRUM: PaymentAsset = {
  network: ARBITRUM_ONE,
  address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  symbol: 'USDC',
  decimals: 6,
  eip712: { name: 'USD Coin', version: '2' },
  assetTransferMethod: 'eip3009',
  eip2612PermitFunctional: true,
};

export const USDC_BASE: PaymentAsset = {
  network: BASE,
  address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  symbol: 'USDC',
  decimals: 6,
  eip712: { name: 'USD Coin', version: '2' },
  assetTransferMethod: 'eip3009',
  eip2612PermitFunctional: true,
};

export const PAYMENT_ASSETS: readonly PaymentAsset[] = [USDS_ARBITRUM, USDC_ARBITRUM, USDC_BASE];

export function findAsset(network: string, address: string): PaymentAsset | undefined {
  let normalized: string;
  try {
    normalized = getAddress(address);
  } catch {
    return undefined;
  }
  return PAYMENT_ASSETS.find((a) => a.network === network && getAddress(a.address) === normalized);
}

/**
 * Convert a decimal amount ("0.01" or "$0.01") to the token's atomic units
 * with exact string arithmetic. Floating point never touches the value.
 */
export function toAtomicAmount(amount: string, decimals: number): string {
  const cleaned = amount.trim().replace(/^\$/, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error(`Invalid amount "${amount}": expected a non-negative decimal such as "0.01"`);
  }
  const fraction = cleaned.split('.')[1] ?? '';
  if (fraction.length > decimals) {
    throw new Error(`Invalid amount "${amount}": more than ${decimals} decimal places`);
  }
  const atomic = parseUnits(cleaned, decimals);
  if (atomic === 0n) {
    throw new Error(`Invalid amount "${amount}": must be greater than zero`);
  }
  return atomic.toString();
}

/**
 * The `extra` block a seller must publish for this asset.
 *
 * For a Permit2 asset whose `permit()` does not work (USDs today) the EIP-712
 * name and version are deliberately left out. The upstream x402 client reads
 * their absence as "do not sign an EIP-2612 permit" and uses ERC-20 approval
 * gas sponsoring instead, which is the path that settles.
 */
export function requirementsExtra(asset: PaymentAsset): Record<string, string> {
  const includeDomain = asset.assetTransferMethod === 'eip3009' || asset.eip2612PermitFunctional;
  return {
    ...(includeDomain ? { name: asset.eip712.name, version: asset.eip712.version } : {}),
    ...(asset.assetTransferMethod === 'permit2' ? { assetTransferMethod: 'permit2' } : {}),
  };
}

/** Build the x402 route `price` for an amount in an asset from this registry. */
export function priceIn(asset: PaymentAsset, amount: string): AssetAmount {
  return {
    amount: toAtomicAmount(amount, asset.decimals),
    asset: asset.address,
    extra: requirementsExtra(asset),
  };
}

/** Price an x402 route in USDs on Arbitrum One, e.g. `usdsPrice('0.01')`. */
export function usdsPrice(amount: string): AssetAmount {
  return priceIn(USDS_ARBITRUM, amount);
}

/**
 * Buyer-side opt-in. The upstream x402 client only pays in its built-in
 * default assets unless a token is listed in `spendControls.allowedAssets`,
 * and USDs is not a default asset. Pass the result to
 * `client.setSpendControls({ allowedAssets: [usdsSpendControl('1')] })`.
 *
 * @param maxPerPayment - Largest single USDs payment the buyer will sign, as a decimal string.
 */
export function usdsSpendControl(maxPerPayment: string): SpendControlAsset {
  return {
    network: USDS_ARBITRUM.network,
    asset: USDS_ARBITRUM.address,
    maxAmountPerPayment: toAtomicAmount(maxPerPayment, USDS_ARBITRUM.decimals),
  };
}
