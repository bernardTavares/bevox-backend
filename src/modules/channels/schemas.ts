import { z } from "zod";

export const orgParam = z.object({ organization_id: z.string().uuid() });
