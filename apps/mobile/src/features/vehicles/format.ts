import type { VehicleCatalogueEntry } from '@chargeroad/shared';

export function variantLabel(vehicle: Pick<VehicleCatalogueEntry, 'trim' | 'variant'>): string {
  const parts = [vehicle.trim, vehicle.variant].filter((part): part is string =>
    Boolean(part) && part?.toLowerCase() !== 'base');
  return [...new Set(parts)].join(' · ') || 'Standart';
}

export function formatNumber(value: number | null, suffix: string): string {
  return value === null ? 'Bilgi yok' : value.toLocaleString('tr-TR', { maximumFractionDigits: 1 }) + ' ' + suffix;
}

export function connectorLabel(value: string): string {
  const labels: Record<string, string> = {
    ccs1: 'CCS1', ccs2: 'CCS2', type1: 'Type 1', type2: 'Type 2',
    nacs: 'NACS', chademo: 'CHAdeMO', tesla_type2: 'Tesla Type 2',
    gb_t_ac: 'GB/T AC', gb_t_dc: 'GB/T DC',
  };
  return labels[value] ?? value;
}
