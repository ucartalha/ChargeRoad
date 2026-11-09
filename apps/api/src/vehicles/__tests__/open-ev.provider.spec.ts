import { createHash } from 'node:crypto';
import { OpenEvProvider } from '../import/open-ev.provider';
import { VehicleImportService } from '../import/vehicle-import.service';
import { VehicleImportRepository } from '../import/vehicle-import.repository';
import { fixtureBytes, fixtureDataset } from './fixtures';

describe('OpenEV release download', () => {
  afterEach(() => jest.restoreAllMocks());

  it('resolves latest to a concrete version and validates the matching JSON asset', async () => {
    const bytes = fixtureBytes(fixtureDataset());
    const digest = createHash('sha256').update(bytes).digest('hex');
    const url = 'https://github.com/open-ev-data/open-ev-data-dataset/releases/download/v1.0.0/open-ev-data-v1.0.0.json';
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ tag_name: 'v1.0.0', draft: false, prerelease: false,
        assets: [{ name: 'open-ev-data-v1.0.0.json', browser_download_url: url, digest: 'sha256:' + digest }] })))
      .mockResolvedValueOnce(new Response(Buffer.from(bytes)));
    const result = await new OpenEvProvider().fetchSnapshot('latest');
    expect(result.version).toBe('v1.0.0');
    expect(result.vehicles).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(url);
  });

  it('does not mutate the database when the source download fails', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 503 }));
    const repository = { save: jest.fn() } as unknown as VehicleImportRepository;
    const service = new VehicleImportService(new OpenEvProvider(), repository);
    await expect(service.refresh('latest')).rejects.toThrow('503');
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('rejects arbitrary URLs and unexpected release hosts', async () => {
    const provider = new OpenEvProvider();
    await expect(provider.fetchSnapshot('http://localhost/private')).rejects.toThrow('version');
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      tag_name: 'v1.0.0', draft: false, prerelease: false,
      assets: [{ name: 'open-ev-data-v1.0.0.json', browser_download_url: 'https://example.test/private' }],
    })));
    await expect(provider.fetchSnapshot('latest')).rejects.toThrow('asset');
  });
});
