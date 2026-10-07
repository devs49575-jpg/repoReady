import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  MONGODB_URI: z
    .string({ error: 'MONGODB_URI is required' })
    .regex(/^mongodb(\+srv)?:\/\//, 'MONGODB_URI must start with mongodb:// or mongodb+srv://'),
  GITHUB_TOKEN: z.string({ error: 'GITHUB_TOKEN is required' }).min(1, 'GITHUB_TOKEN is required'),
  // Normalized to a bare origin: browsers send `https://host` (no slash or path), and CORS compares
  // exactly, so `https://host/` would silently block every request (seen on the first deploy).
  CLIENT_ORIGIN: z
    .url()
    .default('http://localhost:5173')
    .transform((value) => new URL(value).origin),
  MAX_REPO_SIZE_KB: z.coerce.number().int().positive().default(100_000),
  ANALYSIS_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
  CACHE_TTL_HOURS: z.coerce.number().positive().default(24),
  // Private repo mode (Addendum 01, 5.1)
  PRIVATE_MODE_ENABLED: z.stringbool().default(true),
  PRIVATE_REPORT_TTL_MINUTES: z.coerce
    .number()
    .int()
    .positive()
    .max(24 * 60)
    .default(60),
  MAX_PRIVATE_REPORTS: z.coerce.number().int().positive().default(50),
  // Heap cap for the madge worker thread. Lower it on small hosts (e.g. 256 on a 512 MB instance).
  ARCHITECTURE_MAX_MEMORY_MB: z.coerce.number().int().min(64).max(4096).default(512),
  // Per-IP rate limits (Section 10).
  RATE_LIMIT_CREATES_PER_HOUR: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_READS_PER_MINUTE: z.coerce.number().int().positive().default(120),
});

export type Config = z.infer<typeof envSchema>;

/** Parses and validates environment variables. Throws a readable error listing every problem. */
export function parseConfig(env: Record<string, string | undefined>): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}\nSee .env.example.`);
  }
  return result.data;
}

/** Loads a .env file (server dir first, then repo root) without overriding real env vars. */
function loadDotEnv(): void {
  for (const candidate of ['.env', '../.env']) {
    const path = resolve(process.cwd(), candidate);
    if (existsSync(path)) {
      process.loadEnvFile(path);
      return;
    }
  }
}

let cached: Config | null = null;

export function getConfig(): Config {
  if (!cached) {
    loadDotEnv();
    cached = parseConfig(process.env);
  }
  return cached;
}
