import { z } from 'zod';
import { parseSnapshot } from './vehicle-snapshot';
import type { VehicleSnapshot } from './vehicle-snapshot';

export interface VehicleDataProvider {
  fetchSnapshot(version: string): Promise<VehicleSnapshot>;
}

const releaseSchema = z.object({
  tag_name: z.string().regex(/^v\d+\.\d+\.\d+$/),
  draft: z.literal(false),
  prerelease: z.literal(false),
  assets: z.array(z.object({
    name: z.string(),
    browser_download_url: z.string().url(),
    digest: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullish(),
  })),
});

async function download(url: string, maxBytes: number): Promise<Uint8Array> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(60_000),
    headers: { 'User-Agent': 'ChargeRoad-vehicle-import', Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Vehicle source returned HTTP ' + response.status);
  if (Number(response.headers.get('content-length')) > maxBytes)
    throw new Error('Vehicle source response exceeds size limit');
  if (!response.body) throw new Error('Vehicle source response has no body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('Vehicle source response exceeds size limit');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export class OpenEvProvider implements VehicleDataProvider {
  async fetchSnapshot(version: string): Promise<VehicleSnapshot> {
    if (version !== 'latest' && !/^v\d+\.\d+\.\d+$/.test(version))
      throw new Error('Vehicle version must be latest or vMAJOR.MINOR.PATCH');
    const endpoint = version === 'latest' ? 'latest' : 'tags/' + version;
    const metadata = await download(
      'https://api.github.com/repos/open-ev-data/open-ev-data-dataset/releases/' + endpoint,
      1_000_000,
    );
    const release = releaseSchema.parse(JSON.parse(Buffer.from(metadata).toString('utf8')));
    if (version !== 'latest' && version !== release.tag_name) throw new Error('Release version mismatch');
    const name = 'open-ev-data-' + release.tag_name + '.json';
    const asset = release.assets.find((candidate) => candidate.name === name);
    const expectedUrl = 'https://github.com/open-ev-data/open-ev-data-dataset/releases/download/' + release.tag_name + '/' + name;
    if (!asset || asset.browser_download_url !== expectedUrl) throw new Error('Expected vehicle dataset asset missing');
    return parseSnapshot(await download(expectedUrl, 25_000_000), release.tag_name, expectedUrl, asset.digest ?? undefined);
  }
}
