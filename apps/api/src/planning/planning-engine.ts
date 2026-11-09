import { z } from 'zod';
import { planningResultSchema, weatherQuerySchema } from '@chargeroad/shared';
import type { PlanningInput } from '@chargeroad/shared';

// This is our application-owned engine, not an external routing/data provider.
export const engineStepSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('weather_required'), queries: z.array(weatherQuerySchema).min(1) }).strict(),
  z.object({ kind: z.literal('result'), result: planningResultSchema }).strict(),
]);
export type EngineStep = z.infer<typeof engineStepSchema>;

export abstract class PlanningEngine {
  // Charging changes passage times; request new samples rather than reusing departure-time weather.
  abstract step(input: PlanningInput, signal: AbortSignal): Promise<EngineStep>;
}
