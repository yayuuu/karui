import { z } from 'zod';

// Shared validation for environment configuration and programmatic pool users.
export const pluginMemoryLimits = z.object({
  maxOldGenerationSizeMb: z.coerce.number().int().min(16).max(4096).default(64),
  maxYoungGenerationSizeMb: z.coerce.number().int().min(4).max(1024).default(16),
  stackSizeMb: z.coerce.number().int().min(1).max(64).default(4),
}).strict();

export type PluginMemoryLimits = z.infer<typeof pluginMemoryLimits>;
