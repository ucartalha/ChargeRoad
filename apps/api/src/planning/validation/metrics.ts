import { z } from 'zod';

export function percentile(values: readonly number[], fraction: number): number | null {
  if (fraction <= 0 || fraction > 1 || !Number.isFinite(fraction) || values.some((n) => !Number.isFinite(n)))
    throw new Error('Invalid percentile input');
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(fraction * sorted.length) - 1];
}
export function latencySummary(samples: readonly { status: string; durationMs: number }[]) {
  if (samples.some((s) => !Number.isFinite(s.durationMs) || s.durationMs < 0)) throw new Error('Invalid latency');
  const summary = (values: number[]) => ({ samples: values.length,
    p50Ms: percentile(values, .5), p95Ms: percentile(values, .95), p99Ms: percentile(values, .99),
    maxMs: values.length ? values.reduce((max, value) => Math.max(max, value), 0) : null });
  return {
    all: summary(samples.map((s) => s.durationMs)),
    plannedOnly: summary(samples.filter((s) => s.status === 'planned').map((s) => s.durationMs)),
    counts: Object.fromEntries([...new Set(samples.map((s) => s.status))].sort()
      .map((status) => [status, samples.filter((s) => s.status === status).length])),
  };
}

const observed = z.object({
  arrivalSocPercent: z.number().finite().min(0).max(100),
  consumedKwh: z.number().finite().nonnegative(), chargingSeconds: z.number().finite().nonnegative(),
}).strict();
export const tripValidationRecordSchema = z.object({
  id: z.string().min(1), vehicleKey: z.enum(['ioniq6-2023-53-rwd-18', 'ioniq5-2025-63-rwd-19']),
  split: z.enum(['calibration', 'holdout']),
  collectionPermission: z.literal('explicit_validation_permission'),
  distanceKm: z.number().finite().positive(),
  speed: z.object({ kind: z.enum(['cruise', 'trip_average']), kph: z.number().finite().nonnegative() }).strict(),
  ambientTemperatureC: z.number().finite().nullable(), hvac: z.enum(['on', 'off', 'unknown']),
  measuredEnergyBoundary: z.literal('battery_dc'),
  evidence: z.object({ kind: z.enum(['user_report', 'documented_field_measurement']),
    method: z.string().min(1), referenceId: z.string().min(1) }).strict(),
  measured: observed,
  predicted: observed.extend({ modelVersion: z.string().min(1) }).strict(),
}).strict();

export function tripAccuracy(rawRecords: unknown) {
  const records = z.array(tripValidationRecordSchema).parse(rawRecords);
  if (new Set(records.map((r) => r.id)).size !== records.length) throw new Error('Duplicate trip ID across splits');
  // Only independent holdout trips count towards validation accuracy.
  const holdout = records.filter((r) => r.split === 'holdout');
  const errors = holdout.map((r) => ({ id: r.id, vehicleKey: r.vehicleKey, modelVersion: r.predicted.modelVersion,
    socErrorPercentagePoints: r.predicted.arrivalSocPercent - r.measured.arrivalSocPercent,
    energyErrorKwh: r.predicted.consumedKwh - r.measured.consumedKwh,
    consumptionErrorKwhPer100Km: (r.predicted.consumedKwh - r.measured.consumedKwh) * 100 / r.distanceKm,
    chargingErrorSeconds: r.predicted.chargingSeconds - r.measured.chargingSeconds,
  }));
  return { calibrationRecords: records.length - holdout.length, holdoutRecords: holdout.length,
    status: holdout.length ? 'observations_available' : 'awaiting_field_data',
    errors,
    // No invented accuracy or cross-variant average when measurements are absent.
    groups: [...new Set(errors.map((e) => `${e.vehicleKey}/${e.modelVersion}`))].map((key) => {
      const rows = errors.filter((e) => `${e.vehicleKey}/${e.modelVersion}` === key);
      return { key, samples: rows.length,
        socMaePercentagePoints: rows.reduce((n, e) => n + Math.abs(e.socErrorPercentagePoints), 0) / rows.length,
        optimisticSocErrorP95: percentile(rows.map((e) => Math.max(0, e.socErrorPercentagePoints)), .95),
        optimisticSocErrorP99: percentile(rows.map((e) => Math.max(0, e.socErrorPercentagePoints)), .99) };
    }) };
}
