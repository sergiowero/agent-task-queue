import { z } from "zod";

const envSchema = z.object({
  PORT: z
    .string()
    .default("3000")
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().positive().int().max(65535)),
  AGENTQ_DB_PATH: z.string().default("agentq.db"),
});

export type Env = z.infer<typeof envSchema>;

let validated: Env | null = null;

export function validateEnv(): Env {
  if (validated) return validated;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Environment variable validation failed:");
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  validated = result.data;
  return validated;
}

export function getEnv(): Env {
  if (!validated) {
    return validateEnv();
  }
  return validated;
}
