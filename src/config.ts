import { z } from 'zod';
import { ARBITRUM_ONE, BASE } from './assets.js';

const flag = z
  .string()
  .optional()
  .transform((v) => (v === undefined ? undefined : !['', '0', 'false', 'no'].includes(v.toLowerCase())));

/** One RPC URL, or several comma-separated URLs tried in order when one fails. */
const rpcList = z
  .string()
  .transform((v) => v.split(',').map((u) => u.trim()).filter(Boolean))
  .pipe(z.array(z.string().url()).min(1, 'at least one RPC URL is required'));

const envSchema = z.object({
  FACILITATOR_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, 'FACILITATOR_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key'),
  ARBITRUM_RPC_URL: rpcList.default('https://arb1.arbitrum.io/rpc'),
  BASE_RPC_URL: rpcList.default('https://mainnet.base.org'),
  ENABLE_ARBITRUM: flag,
  ENABLE_BASE: flag,
  PORT: z.coerce.number().int().min(1).max(65535).default(3402),
  HOST: z.string().default('0.0.0.0'),
  CORS_ORIGINS: z.string().default('*'),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  CONFIRMATION_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  MIN_GAS_BALANCE_WEI: z.coerce.bigint().nonnegative().default(200_000_000_000_000n),
  MAX_SPONSORED_GAS_WEI: z.coerce.bigint().nonnegative().default(100_000_000_000_000n),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  PUBLIC_URL: z.string().url().optional(),
  DEMO_PAY_TO: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, 'DEMO_PAY_TO must be a 0x-prefixed address')
    .optional(),
  DEMO_PRICE: z.string().regex(/^\d+(\.\d+)?$/, 'DEMO_PRICE must be a decimal such as 0.001').default('0.001'),
  STATS_FROM_BLOCK: z.coerce.bigint().nonnegative().default(506_000_000n),
});

export interface NetworkConfig {
  network: typeof ARBITRUM_ONE | typeof BASE;
  /** Tried in order; later URLs take over when an earlier one errors. */
  rpcUrls: string[];
}

export interface FacilitatorConfig {
  privateKey: `0x${string}`;
  networks: NetworkConfig[];
  port: number;
  host: string;
  corsOrigins: string[];
  rateLimitMax: number;
  rateLimitWindowMs: number;
  confirmationTimeoutMs: number;
  minGasBalanceWei: bigint;
  /** Upper bound on ETH sent to a buyer to cover their Permit2 approve transaction. */
  maxSponsoredGasWei: bigint;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** Public base URL used in the demo page; derived from the request when unset. */
  publicUrl: string | undefined;
  /** When set, /demo/usds-snapshot is a live paid route paying this address. */
  demo: { payTo: `0x${string}`; price: string } | undefined;
  /** First Arbitrum block the settlement index scans. */
  statsFromBlock: bigint;
}

/** Parse and validate configuration. Arbitrum is on by default, Base is opt-in. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): FacilitatorConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const e = parsed.data;

  const networks: NetworkConfig[] = [];
  if (e.ENABLE_ARBITRUM ?? true) networks.push({ network: ARBITRUM_ONE, rpcUrls: e.ARBITRUM_RPC_URL });
  if (e.ENABLE_BASE ?? false) networks.push({ network: BASE, rpcUrls: e.BASE_RPC_URL });
  if (networks.length === 0) {
    throw new Error('Invalid configuration: enable at least one network (ENABLE_ARBITRUM or ENABLE_BASE)');
  }

  return {
    privateKey: e.FACILITATOR_PRIVATE_KEY as `0x${string}`,
    networks,
    port: e.PORT,
    host: e.HOST,
    corsOrigins: e.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    rateLimitMax: e.RATE_LIMIT_MAX,
    rateLimitWindowMs: e.RATE_LIMIT_WINDOW_MS,
    confirmationTimeoutMs: e.CONFIRMATION_TIMEOUT_MS,
    minGasBalanceWei: e.MIN_GAS_BALANCE_WEI,
    maxSponsoredGasWei: e.MAX_SPONSORED_GAS_WEI,
    logLevel: e.LOG_LEVEL,
    publicUrl: e.PUBLIC_URL,
    demo: e.DEMO_PAY_TO ? { payTo: e.DEMO_PAY_TO as `0x${string}`, price: e.DEMO_PRICE } : undefined,
    statsFromBlock: e.STATS_FROM_BLOCK,
  };
}
