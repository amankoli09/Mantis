import { z } from 'zod';

export const updateUserSchema = z.object({
  id: z.string().uuid(),
  isActive: z.boolean(),
});
