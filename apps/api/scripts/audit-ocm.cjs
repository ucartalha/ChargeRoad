// Bounded, read-only provider investigation. Never publishes catalogue data.
const { request } = require('node:https');
const { readFile, writeFile, mkdir } = require('node:fs/promises');
const { resolve } = require('node:path');
const { createHash } = require('node:crypto');
require('dotenv').config({ path: resolve(__dirname, '../../../.env'), quiet: true });
const root = resolve(__dirname, '../../..');
const directory = resolve(root, 'artifacts/task8-ocm');
const key = process.env.OPEN_CHARGE_MAP_API_KEY;
const sha = b => createHash('sha256').update(b).digest('hex');
const fold = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').toLowerCase();
let calls = 0;
let lastRequest = 0;
const receipts = [];

async function get(endpoint, params, name) {
  const url = new URL('https://api.openchargemap.io/v3/' + endpoint + '/');
  for (const [k, v] of Object.entries({ ...params, client: 'ChargeRoad' })) url.searchParams.set(k, String(v));
  const path = resolve(directory, name + '.json');
  try {
    const receipt = JSON.parse(await readFile(path + '.manifest.json', 'utf8'));
    const bytes = await readFile(path);
    if (receipt.url === url.href && receipt.httpStatus === 200 && sha(bytes) === receipt.sha256 &&
      Date.now() - Date.parse(receipt.retrievedAt) >= 0 && Date.now() - Date.parse(receipt.retrievedAt) < 86400000) {
      receipts.push({ ...receipt, cached: true });
      return { data: JSON.parse(bytes.toString('utf8')), receipt, cached: true };
    }
  } catch (e) { if (e.code !== 'ENOENT') throw new Error('Saved source cache validation failed'); }
  if (++calls > 26) throw new Error('Audit request budget exceeded');
  // A conservative audit pacing choice, not a claimed provider quota.
  await new Promise(res => setTimeout(res, Math.max(0, 1100 - (Date.now() - lastRequest))));
  lastRequest = Date.now();
  const retrievedAt = new Date().toISOString();
  const start = performance.now();
  const response = await new Promise((res, rej) => {
    const req = request(url, { method: 'GET', signal: AbortSignal.timeout(25000), headers: {
      'X-API-Key': key, 'User-Agent': 'ChargeRoad-source-audit/0.1', Accept: 'application/json',
    } }, r => {
      const chunks = []; let size = 0;
      r.on('data', b => { size += b.length;
        if (size > 8 * 1024 * 1024) r.destroy(new Error('Response size limit')); else chunks.push(b); });
      r.on('error', rej);
      r.on('end', () => res({ bytes: Buffer.concat(chunks), status: r.statusCode, retryAfter: r.headers['retry-after'] ?? null }));
    });
    req.on('error', rej); req.end();
  });
  // Do not persist a response that happens to echo the credential.
  if (response.bytes.includes(Buffer.from(key))) throw new Error('Response echoed credential; storage stopped');
  const receipt = { url: url.href, retrievedAt, httpStatus: response.status, retryAfter: response.retryAfter,
    bytes: response.bytes.length, sha256: sha(response.bytes), elapsedMs: Math.round(performance.now() - start) };
  receipts.push({ ...receipt, cached: false });
  await writeFile(path, response.bytes);
  await writeFile(path + '.manifest.json', JSON.stringify(receipt, null, 2) + '\n');
  if (response.status !== 200) throw new Error('OCM HTTP ' + response.status + '; no automatic retry');
  return { data: JSON.parse(response.bytes.toString('utf8')), receipt, cached: false };
}

function countFields(rows) {
  const result = {};
  for (const row of rows) for (const [k, v] of Object.entries(row)) {
    const counts = result[k] ??= { present: 0, nonNull: 0 };
    counts.present++;
    if (v !== null && v !== undefined) counts.nonNull++;
  }
  return result;
}
function distance(a, b) {
  const rad = n => n * Math.PI / 180;
  const dlat = rad(b.Latitude - a.latitude), dlon = rad(b.Longitude - a.longitude);
  const v = Math.sin(dlat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.Latitude)) * Math.sin(dlon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(v), Math.sqrt(Math.max(0, 1 - v)));
}
function summary(rows, ref) {
  const connections = rows.flatMap(r => r.Connections ?? []);
  const statuses = new Map(ref.StatusTypes.map(r => [r.ID, r.Title]));
  const countBy = (items, value) => items.reduce((a, r) => { const k = String(value(r) ?? 'missing'); a[k] = (a[k] ?? 0) + 1; return a; }, {});
  return { rows: rows.length, connections: connections.length,
    providers: countBy(rows, r => r.DataProviderID), operators: countBy(rows, r => r.OperatorID),
    stationStatuses: countBy(rows, r => statuses.get(r.StatusTypeID) ?? r.StatusTypeID),
    connectionStatuses: countBy(connections, r => statuses.get(r.StatusTypeID) ?? r.StatusTypeID),
    stationFields: countFields(rows), connectionFields: countFields(connections),
    licenseReview: rows.reduce((a, r) => {
      const license = String(r.DataProvider?.License ?? '');
      const noncommercial = /non[\s-]?commercial|by-nc/i.test(license);
      const group = noncommercial ? 'noncommercial_exclude_from_product_import' : 'requires_source_license_validation';
      a[group] = (a[group] ?? 0) + 1; return a;
    }, {}),
    liveAvailabilityVerified: false, reason: 'General status timestamps are not verified EVSE observations.' };
}

async function main() {
  if (!key || !/^[a-f0-9-]{36}$/i.test(key)) throw new Error('Valid OPEN_CHARGE_MAP_API_KEY required');
  await mkdir(directory, { recursive: true });
  const compare = process.argv.includes('--compare');
  const report = { schemaVersion: 1, startedAt: new Date().toISOString(), cataloguePublished: false,
    mode: compare ? 'sample_comparison' : 'small_sample', requests: receipts };
  try {
    const reference = await get('referencedata', {}, 'reference');
    const ref = reference.data;
    if (!Array.isArray(ref.Operators) || !Array.isArray(ref.StatusTypes) || !Array.isArray(ref.DataProviders)) throw new Error('Invalid reference envelope');
    report.reference = { countries: ref.Countries.length, operators: ref.Operators.length,
      statusTypes: ref.StatusTypes, providers: ref.DataProviders.map(p => ({ id: p.ID, title: p.Title,
        openLicensed: p.IsOpenDataLicensed ?? null, license: p.License ?? null })) };
    if (!compare) {
      const sample = await get('poi', { output: 'json', countrycode: 'TR', opendata: true,
        maxresults: 25, compact: false, verbose: true, includecomments: false, sortby: 'id_asc' }, 'tr-small-sample');
      if (!Array.isArray(sample.data) || sample.data.length > 25) throw new Error('Invalid or oversized sample');
      report.sample = summary(sample.data, ref);
      report.scope = 'First 25 ID-ordered open-data TR records; not a representative national survey.';
    } else {
      const sample = JSON.parse(await readFile(resolve(root, 'docs/validation/task8-station-sample.json'), 'utf8'));
      if (sample.stations.length !== 24) throw new Error('Expected the reviewed 24-station sample');
      const results = [];
      for (const station of sample.stations) {
        const operators = ref.Operators.filter(o => fold(o.Title) === fold(station.operator) || fold(o.Title).startsWith(fold(station.operator) + ' '));
        if (!operators.length) { results.push({ epdkStationId: station.epdkStationId, operator: station.operator, status: 'operator_lookup_missing' }); continue; }
        const result = await get('poi', { output: 'json', countrycode: 'TR', opendata: true,
          latitude: station.latitude, longitude: station.longitude, distance: 2, distanceunit: 'km',
          operatorid: operators.map(o => o.ID).join(','), maxresults: 100,
          compact: false, verbose: true, includecomments: false }, 'near-' + station.epdkStationId.replace(/\D/g, ''));
        if (!Array.isArray(result.data) || result.data.length > 100) throw new Error('Invalid comparison envelope');
        const candidates = result.data.map(p => ({ p, meters: distance(station, p.AddressInfo) })).filter(c => Number.isFinite(c.meters)).sort((a, b) => a.meters - b.meters);
        // Nearness only yields review candidates. It never creates a canonical crosswalk.
        results.push({ epdkStationId: station.epdkStationId, operator: station.operator,
          operatorIds: operators.map(o => o.ID), status: 'queried', retrievedAt: result.receipt.retrievedAt,
          candidatesReturned: candidates.length, searchLimitReached: result.data.length === 100,
          candidatesWithin150m: candidates.filter(c => c.meters <= 150).length,
          verifiedMatch: null, liveAvailabilityVerified: false,
          candidates: candidates.map(({ p, meters }) => ({ ocmId: p.ID, distanceMeters: Math.round(meters),
            operatorId: p.OperatorID, providerId: p.DataProviderID,
            title: p.AddressInfo?.Title ?? null, address: [p.AddressInfo?.AddressLine1, p.AddressInfo?.Town].filter(Boolean).join(', '),
            license: p.DataProvider?.License ?? null, openLicensed: p.DataProvider?.IsOpenDataLicensed ?? null,
            statusTypeId: p.StatusTypeID ?? null, lastRecordUpdatedAt: p.DateLastStatusUpdate ?? null,
            lastVerifiedAt: p.DateLastVerified ?? null, numberOfPoints: p.NumberOfPoints ?? null,
            connections: (p.Connections ?? []).map(c => ({ ocmConnectionId: c.ID, connectionTypeId: c.ConnectionTypeID,
              type: c.ConnectionType?.Title ?? null, powerKw: c.PowerKW ?? null,
              quantity: c.Quantity ?? null, statusTypeId: c.StatusTypeID ?? null })) })) });
      }
      report.comparison = { sourceSampleRetrievedAt: sample.sourceRetrievedAt, selected: sample.stations.length,
        searchRadiusKm: 2, reviewRadiusMeters: 150, matchingPolicy: 'distance/operator only creates review candidates; no automatic verified matches',
        rows: results };
      const unique = [...new Map(results.flatMap(r => r.candidates ?? []).map(c => [c.ocmId, c])).values()];
      report.comparison.summary = {
        queried: results.filter(r => r.status === 'queried').length,
        rowsWithNearbyCandidates: results.filter(r => r.candidatesReturned > 0).length,
        rowsWithCandidateWithin150m: results.filter(r => r.candidatesWithin150m > 0).length,
        rowsWithoutNearbyOpenCandidate: results.filter(r => r.candidatesReturned === 0).length,
        uniqueCandidateLocations: unique.length, verifiedMatches: 0,
        liveAvailableStatusClaims: unique.filter(c => c.statusTypeId === 10).length,
        liveOccupiedStatusClaims: unique.filter(c => c.statusTypeId === 20).length,
        effectiveLiveAvailability: 'unknown',
        generalStatusPresent: unique.filter(c => c.statusTypeId !== null).length,
        connectionTypePresent: unique.flatMap(c => c.connections).filter(c => c.connectionTypeId !== undefined && c.connectionTypeId !== null).length,
        powerPresent: unique.flatMap(c => c.connections).filter(c => c.powerKw !== null).length,
        equipmentSummaryRows: unique.flatMap(c => c.connections).length,
        perOperator: Object.fromEntries([...new Set(results.map(r => r.operator))].map(operator => {
          const group = results.filter(r => r.operator === operator);
          return [operator, { selected: group.length, withNearbyCandidates: group.filter(r => r.candidatesReturned > 0).length,
            withCandidateWithin150m: group.filter(r => r.candidatesWithin150m > 0).length }];
        })),
        caveat: 'Nearby candidates are not confirmed POI/equipment matches or a national coverage estimate.',
      };
    }
  } catch (e) {
    report.error = /^OCM HTTP |^Invalid |^Expected |^Audit |^Saved |^Response echoed/.test(e.message) ? e.message : (e.code ?? e.name);
    process.exitCode = 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    report.networkCallsThisRun = calls;
    const name = compare ? 'task8-ocm-comparison.json' : 'task8-ocm-audit.json';
    await writeFile(resolve(root, 'docs/validation', name), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ report: 'docs/validation/' + name, error: report.error ?? null,
      networkCalls: calls, sampleRows: report.sample?.rows,
      comparisonRows: report.comparison?.rows.length,
      statuses: report.sample?.stationStatuses }, null, 2));
  }
}
main().catch(e => { console.error(e.code ?? e.name); process.exitCode = 1; });
