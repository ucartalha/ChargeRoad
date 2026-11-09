import type { VehicleCatalogueDetail, VehicleCataloguePage } from '@chargeroad/shared';

export type CatalogueOption = { slug: string; name: string; sourceKey: string };

export class CatalogueApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'CatalogueApiError';
  }
}

export async function catalogueRequest<T>(path: string, signal?: AbortSignal): Promise<T> {
  const baseUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, '');
  if (!baseUrl) throw new Error('Araç kataloğuna şu anda bağlanılamıyor.');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', cancel);
  const timeout = setTimeout(cancel, 12_000);
  try {
    const response = await fetch(baseUrl + path, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new CatalogueApiError(response.status, 'Araç bilgileri alınamadı.');
    return await response.json() as T;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}

export const cataloguePaths = {
  makes: '/vehicles/makes',
  models: (make: string) => '/vehicles/models?make=' + encodeURIComponent(make),
  variants: (make: string, model: string, offset = 0) =>
    '/vehicles?make=' + encodeURIComponent(make) + '&model=' + encodeURIComponent(model)
      + '&limit=50&offset=' + offset,
  detail: (id: string) => '/vehicles/' + encodeURIComponent(id),
};

export type { VehicleCatalogueDetail, VehicleCataloguePage };
