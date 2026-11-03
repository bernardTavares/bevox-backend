import { z } from "zod";

export const orgParamSchema = z.object({ organization_id: z.string().uuid() });

const aiMode = z.enum(["manual_assisted", "copilot", "autonomous_supervised"]);

export const patchBodySchema = z
  .object({
    current_mode: aiMode.optional(),
    allowed_actions_json: z.record(z.string(), z.unknown()).optional(),
    required_approvals_json: z.record(z.string(), z.unknown()).optional(),
    confidence_thresholds_json: z.record(z.string(), z.unknown()).optional(),
    reason: z.string().min(1).optional(),
  })
  .strict();

export type PatchBody = z.infer<typeof patchBodySchema>;
