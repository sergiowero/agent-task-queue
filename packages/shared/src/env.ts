import { z } from "zod";

const envSchema = z.object({
  PORT: z
    .string()
    .default("3000")
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().positive().int().max(65535)),
  AGENTQ_DB_PATH: z.string().default("~/agentq/agentq.db"),
});

export type Env = z.infer<typeof envSchema>;

// Not cached: the parse is trivial and tests change AGENTQ_DB_PATH between files.
export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Environment variable validation failed:");
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

export function getEnv(): Env {
  return validateEnv();
}
