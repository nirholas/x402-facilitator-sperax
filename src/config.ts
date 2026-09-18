import { z } from 'zod';
import { ARBITRUM_ONE, BASE } from './assets.js';

const flag = z
  .string()
  .optional()
  .transform((v) => (v === undefined ? undefined : !['', '0', 'false', 'no'].includes(v.toLowerCase())));

const envSchema = z.object({
  FACILITATOR_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, 'FACILITATOR_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key'),
  ARBITRUM_RPC_URL: z.string().url().default('https://arb1.arbitrum.io/rpc'),
  BASE_RPC_URL: z.string().url().default('https://mainnet.base.org'),
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
});

export interface NetworkConfig {
  network: typeof ARBITRUM_ONE | typeof BASE;
  rpcUrl: string;
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
  if (e.ENABLE_ARBITRUM ?? true) networks.push({ network: ARBITRUM_ONE, rpcUrl: e.ARBITRUM_RPC_URL });
  if (e.ENABLE_BASE ?? false) networks.push({ network: BASE, rpcUrl: e.BASE_RPC_URL });
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
  };
}
