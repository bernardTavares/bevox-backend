import { z } from "zod";

export const orgParamSchema = z.object({ organization_id: z.string().uuid() });
export const idParamSchema = z.object({
  organization_id: z.string().uuid(),
  id: z.string().uuid(),
});

export const listQuerySchema = z.object({
  status: z.string().optional(),
  suggestion_type: z.enum(["reply", "slot", "charge", "refund"]).optional(),
});

export const rejectBodySchema = z
  .object({
    rejection_reason_code: z.string().min(1),
    rejection_reason_text: z.string().optional(),
  })
  .strict();

export const editBodySchema = z.object({ response_text: z.string().min(1) }).strict();

export type RejectBody = z.infer<typeof rejectBodySchema>;
export type EditBody = z.infer<typeof editBodySchema>;
