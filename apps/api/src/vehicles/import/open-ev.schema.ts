import { z } from 'zod';

const positive = z.number().positive();
const nonnegative = z.number().nonnegative();
const text = z.string().min(1).max(500);
const slugName = z.object({ slug: text, name: text }).passthrough();
const timestamp = z.iso.datetime({ offset: true });
const point = z.object({
  soc_percent: z.number().min(0).max(100),
  power_kw: nonnegative.optional(),
  current_a: nonnegative.optional(),
  voltage_v: positive.optional(),
}).passthrough();

const curve = z.object({
  curve_type: z.enum(['power_by_soc', 'current_by_soc']),
  points: z.array(point).min(1).max(1000),
  conditions: z.record(z.string(), z.unknown()).optional(),
  source_url: z.string().url().optional(),
}).passthrough().superRefine((value, context) => {
  const seen = new Set<number>();
  for (const [index, item] of value.points.entries()) {
    if (seen.has(item.soc_percent)) context.addIssue({ code: 'custom', path: ['points', index], message: 'Duplicate state of charge' });
    seen.add(item.soc_percent);
    if (value.curve_type === 'power_by_soc' && item.power_kw === undefined)
      context.addIssue({ code: 'custom', path: ['points', index], message: 'Power curve requires power_kw' });
    if (value.curve_type === 'current_by_soc' && item.current_a === undefined)
      context.addIssue({ code: 'custom', path: ['points', index], message: 'Current curve requires current_a' });
  }
});

export const openEvVehicleSchema = z.object({
  schema_version: z.literal('1.0.0'),
  unique_code: text,
  make: slugName,
  model: slugName,
  year: z.number().int().min(1900).max(2100),
  trim: slugName,
  variant: slugName.optional(),
  vehicle_type: text,
  markets: z.array(z.string().regex(/^[A-Z]{2}$/)).optional(),
  battery: z.object({
    pack_capacity_kwh_net: positive.optional(),
    pack_capacity_kwh_gross: positive.optional(),
  }).passthrough(),
  charge_ports: z.array(z.object({ kind: text, connector: text }).passthrough()),
  charging: z.object({
    ac: z.object({ max_power_kw: nonnegative }).passthrough().optional(),
    dc: z.object({ max_power_kw: nonnegative }).passthrough().optional(),
    dc_charge_curve: curve.optional(),
  }).passthrough(),
  range: z.object({
    rated: z.array(z.object({ cycle: text, range_km: positive }).passthrough()),
    real_world: z.array(z.object({
      profile: text,
      range_km: positive,
      conditions: z.record(z.string(), z.unknown()).optional(),
    }).passthrough()).optional(),
  }).passthrough(),
  efficiency: z.object({
    energy_consumption_wh_per_km: positive.optional(),
    notes: z.string().optional(),
  }).passthrough().optional(),
  sources: z.array(z.record(z.string(), z.unknown())),
  metadata: z.object({ updated_at: timestamp.optional() }).passthrough().optional(),
}).passthrough().superRefine((vehicle, context) => {
  const net = vehicle.battery.pack_capacity_kwh_net;
  const gross = vehicle.battery.pack_capacity_kwh_gross;
  if (net !== undefined && gross !== undefined && net > gross)
    context.addIssue({ code: 'custom', path: ['battery'], message: 'Net capacity exceeds gross capacity' });
});

export const openEvDatasetSchema = z.object({
  schema_version: z.literal('1.0.0'),
  generated_at: timestamp,
  vehicle_count: z.number().int().positive().max(100_000),
  vehicles: z.array(openEvVehicleSchema).min(1).max(100_000),
}).passthrough().superRefine((data, context) => {
  if (data.vehicle_count !== data.vehicles.length)
    context.addIssue({ code: 'custom', path: ['vehicle_count'], message: 'Record count does not match dataset' });
  const seen = new Set<string>();
  for (const [index, vehicle] of data.vehicles.entries()) {
    if (seen.has(vehicle.unique_code))
      context.addIssue({ code: 'custom', path: ['vehicles', index, 'unique_code'], message: 'Duplicate source vehicle identity' });
    seen.add(vehicle.unique_code);
  }
});

export type OpenEvVehicle = z.infer<typeof openEvVehicleSchema>;
