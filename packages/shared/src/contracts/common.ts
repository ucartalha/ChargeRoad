import { z } from 'zod';

export const contractVersionSchema = z.literal('1.0.0');
export const idSchema = z.string().min(1).max(200);
export const finiteSchema = z.number().finite();
export const positiveSchema = finiteSchema.positive();
export const nonnegativeSchema = finiteSchema.nonnegative();
export const percentSchema = finiteSchema.min(0).max(100);
export const timestampSchema = z.iso.datetime({ offset: true });
export const coordinateSchema = z.object({
  latitude: finiteSchema.min(-90).max(90),
  longitude: finiteSchema.min(-180).max(180),
}).strict();

export const sourceReferenceSchema = z.object({
  sourceId: idSchema,
  recordId: idSchema.nullable(),
  version: idSchema.nullable(),
  url: z.string().url().nullable(),
  retrievedAt: timestampSchema,
  publishedAt: timestampSchema.nullable(),
  license: z.string().min(1).nullable(),
}).strict();

export const numberRangeSchema = z.object({ min: finiteSchema, max: finiteSchema }).strict()
  .refine((range) => range.min <= range.max, 'Range minimum exceeds maximum');
export const positiveRangeSchema = z.object({ min: positiveSchema, max: positiveSchema }).strict()
  .refine((range) => range.min <= range.max, 'Range minimum exceeds maximum');
export const percentRangeSchema = z.object({ min: percentSchema, max: percentSchema }).strict()
  .refine((range) => range.min <= range.max, 'Range minimum exceeds maximum');

// Ambient temperature and battery temperature use separate signals.
// An unknown signal is explicit; it must not acquire a numeric fallback.
export const numericObservationSchema = z.discriminatedUnion('origin', [
  z.object({ origin: z.literal('measured'), value: finiteSchema, observedAt: timestampSchema, sourceId: idSchema }).strict(),
  z.object({ origin: z.literal('user_input'), value: finiteSchema, observedAt: timestampSchema }).strict(),
  z.object({ origin: z.literal('estimated'), value: finiteSchema, estimatedAt: timestampSchema, validAt: timestampSchema.nullable(), modelVersion: idSchema }).strict(),
  z.object({ origin: z.literal('unknown'), value: z.null() }).strict(),
]);

export const chargeObservationSchema = numericObservationSchema.refine(
  (signal) => signal.value === null || (signal.value >= 0 && signal.value <= 100),
  'State of charge must be between 0 and 100',
);

export const connectorStandardSchema = z.enum([
  'type1', 'type2', 'ccs1', 'ccs2', 'nacs', 'chademo', 'gb_t_ac', 'gb_t_dc', 'tesla_type2', 'other',
]);

export function strictlyIncreasing(values: number[]): boolean {
  return values.every((value, index) => index === 0 || value > values[index - 1]);
}

export type Coordinate = z.infer<typeof coordinateSchema>;
export type SourceReference = z.infer<typeof sourceReferenceSchema>;
export type NumericObservation = z.infer<typeof numericObservationSchema>;
export type ChargeObservation = z.infer<typeof chargeObservationSchema>;
