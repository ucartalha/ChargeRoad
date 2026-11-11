// Read-only source investigation. Does not publish or replace the station catalogue.
const { request } = require('node:https');
const { readFile, writeFile, mkdir } = require('node:fs/promises');
const { resolve } = require('node:path');
const { createHash } = require('node:crypto');
const { Pool } = require('pg');
require('dotenv').config({ path: resolve(__dirname, '../../../.env'), quiet: true });

const root = resolve(__dirname, '../../..');
const output = resolve(root, 'artifacts/task8-sources');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const endpoint = 'https://apigateway.epdk.gov.tr/sarjIstasyonlari';
const stationArg = process.argv.indexOf('--station');
const stationId = stationArg >= 0 ? process.argv[stationArg + 1] : undefined;
if (stationArg >= 0 && (!stationId || !/^ŞRJ\/\d+$/.test(stationId))) throw new Error('Expected --station ŞRJ/NUMBER');
const requestClass = process.argv.includes('--filtered') || stationId ? 'filtered' : 'national';
const filters = stationId ? { sarjIstasyonuNo: stationId } : requestClass === 'filtered' ? { markaAdi: 'TRUGO' } : {};

function get(url, body) {
  return new Promise((res, rej) => {
    const start = performance.now();
    const req = request(url, {
      method: 'GET', signal: AbortSignal.timeout(45000),
      headers: { 'User-Agent': 'ChargeRoad-source-audit', ...(body === undefined ? {} : {
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
      }) },
    }, response => {
      const chunks = []; let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 64 * 1024 * 1024) response.destroy(new Error('Response size limit'));
        else chunks.push(chunk);
      });
      response.on('error', rej);
      response.on('end', () => res({ status: response.statusCode, bytes: Buffer.concat(chunks),
        elapsedMs: Math.round(performance.now() - start), contentType: response.headers['content-type'] ?? null,
        retryAfter: response.headers['retry-after'] ?? null }));
    });
    req.on('error', rej); req.end(body);
  });
}

function fields(rows) {
  const result = {};
  for (const row of rows) for (const [key, value] of Object.entries(row)) {
    const counter = result[key] ??= { present: 0, nonNull: 0, nonEmpty: 0, types: [] };
    counter.present++;
    if (value !== null) counter.nonNull++;
    if (value !== null && value !== '' && (!Array.isArray(value) || value.length)) counter.nonEmpty++;
    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    if (!counter.types.includes(type)) counter.types.push(type);
  }
  return result;
}

async function main() {
  await mkdir(output, { recursive: true });
  if (process.argv.includes('--sample-only')) {
    const bytes = await readFile(resolve(root, 'artifacts/task7-sources/epdk-stations.json'));
    const receipt = JSON.parse(await readFile(resolve(root, 'artifacts/task7-sources/epdk-stations.json.manifest.json'), 'utf8'));
    if (sha(bytes) !== receipt.rawSha256) throw new Error('Saved catalogue receipt checksum mismatch');
    const source = JSON.parse(bytes.toString('utf8'));
    await saveSample(source.data, receipt.retrievedAt, sha(bytes));
    console.log(JSON.stringify({sample: 'docs/validation/task8-station-sample.json',
      sourceRetrievedAt: receipt.retrievedAt, sourceRows: source.data.length,
      freshSourceQuery: false, providerRequests: 0}));
    return;
  }
  const report = { schemaVersion: 1, startedAt: new Date().toISOString(), mode: requestClass,
    filters, cataloguePublished: false, requests: {}, credentials: {} };
  for (const key of ['GOOGLE_MAPS_API_KEY', 'GOOGLE_PLACES_API_KEY', 'HERE_API_KEY', 'HERE_ACCESS_TOKEN']) {
    const value = process.env[key];
    report.credentials[key] = Boolean(value && !/your[_-]|placeholder|change.?me|example/i.test(value));
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL,
    max: 1, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
  try {
    // Share the existing source gate with regular import workers. No retry loop.
    const slot = await pool.query(`INSERT INTO station_source_fetch_gates(source_key,request_class,next_allowed_at)
      VALUES('epdk-stations',$1,now()+$2*interval '1 second')
      ON CONFLICT(source_key,request_class) DO UPDATE SET next_allowed_at=EXCLUDED.next_allowed_at
      WHERE station_source_fetch_gates.next_allowed_at<=now() RETURNING next_allowed_at`,
    [requestClass, requestClass === 'national' ? 3600 : 60]);
    if (!slot.rowCount) throw new Error('EPDK shared source quota unavailable; no source request made');
    const retrievedAt = new Date().toISOString();
    const response = await get(endpoint, JSON.stringify(filters));
    const file = stationId ? 'epdk-single-station.json' : requestClass === 'national' ? 'epdk-stations.json' : 'epdk-trugo.json';
    await writeFile(resolve(output, file), response.bytes);
    const receipt = { endpoint, retrievedAt, rawSha256: sha(response.bytes), httpStatus: response.status,
      requestClass, filters, method: 'GET', requestBody: JSON.stringify(filters) };
    await writeFile(resolve(output, file + '.manifest.json'), JSON.stringify(receipt, null, 2) + '\n');
    report.requests.catalogue = { ...receipt, bytes: response.bytes.length, elapsedMs: response.elapsedMs,
      retryAfter: response.retryAfter };
    if (response.status !== 200) {
      try {
        const fault = JSON.parse(response.bytes.toString('utf8')).fault;
        if (fault) report.requests.catalogue.fault = {
          code: fault.faultCode, message: fault.faultString, status: fault.faultStatusCode,
        };
      } catch { /* Bounded raw response remains available for offline inspection. */ }
      throw new Error('EPDK HTTP ' + response.status);
    }
    const data = JSON.parse(response.bytes.toString('utf8'));
    if (data.statusCode !== 200 || !Array.isArray(data.data) || data.numRows !== data.data.length || data.errors?.length)
      throw new Error('EPDK response envelope failed validation');
    const rows = data.data;
    const sockets = rows.flatMap(row => row.soketler ?? []);
    report.catalogue = { rootFields: Object.keys(data), rows: rows.length, sockets: sockets.length,
      serviceForms: rows.reduce((a, r) => { a[r.hizmetSekli] = (a[r.hizmetSekli] ?? 0) + 1; return a; }, {}),
      stationFields: fields(rows), socketFields: fields(sockets) };
    for (const [key, url] of Object.entries({
      swagger: endpoint + '?swagger',
      guide: 'https://epdk.gov.tr/Detay/DownloadDocument?id=mqXhIJuluA8=',
    })) {
      try {
        const r = await get(url);
        await writeFile(resolve(output, key === 'swagger' ? 'epdk-swagger.json' : 'epdk-guide.bin'), r.bytes);
        report.requests[key] = { url, status: r.status, bytes: r.bytes.length, sha256: sha(r.bytes), contentType: r.contentType };
        if (key === 'swagger' && r.status === 200) {
          const spec = JSON.parse(r.bytes.toString('utf8'));
          report.swagger = { version: spec.swagger, security: spec.security,
            getParameters: spec.paths?.['/']?.get?.parameters, definitions: spec.definitions };
        }
      } catch (e) { report.requests[key] = { error: e.code ?? e.name }; }
    }
    if (requestClass === 'national') {
      const count = await saveSample(rows, retrievedAt, sha(response.bytes));
      report.comparison = { status: 'not_run', selected: count, googleRequests: 0, hereRequests: 0,
        liveFieldFillRate: null, reason: 'No provider calls made; prepared sample is not a coverage measurement.' };
    }
  } catch (e) {
    report.error = e.code ?? e.message;
    process.exitCode = 1;
  } finally {
    await pool.end();
    report.finishedAt = new Date().toISOString();
    const reportName = stationId ? 'task8-epdk-station-audit.json' : requestClass === 'national' ? 'task8-epdk-audit.json' : 'task8-epdk-filtered-audit.json';
    await writeFile(resolve(root, 'docs/validation', reportName), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ report: 'docs/validation/' + reportName,
      error: report.error ?? null, rows: report.catalogue?.rows, sockets: report.catalogue?.sockets,
      requests: report.requests, comparison: report.comparison }, null, 2));
  }
}
async function saveSample(rows, sourceRetrievedAt, sourceSha256) {
  const selected = [];
  const fold = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').toLowerCase();
  for (const operator of ['Trugo', 'Eşarj', 'ZES']) {
    const eligible = rows.filter(row => row.hizmetSekli === 'HALKA_ACIK' && fold(row.marka) === fold(operator)
      && (row.soketler ?? []).some(s => s.soketTipi === 'DC'));
    eligible.sort((a, b) => sha(Buffer.from(a.sarjIstasyonuNo)).localeCompare(sha(Buffer.from(b.sarjIstasyonuNo))));
    const chosen = []; const cities = new Set();
    for (const row of eligible) {
      const city = String(row.adres).split('/').at(-1).trim();
      if (!cities.has(city)) { chosen.push(row); cities.add(city); }
      if (chosen.length === 8) break;
    }
    for (const row of eligible) {
      if (chosen.length === 8) break;
      if (!chosen.includes(row)) chosen.push(row);
    }
    if (chosen.length !== 8) throw new Error('Insufficient public DC sample for ' + operator);
    for (const row of chosen) selected.push({ operator, epdkStationId: row.sarjIstasyonuNo,
      epdkLicense: row.sarjAgiIsletmecisiLisansNo, name: row.sarjIstasyonuAdi, address: row.adres,
      latitude: Number(row.enlem), longitude: Number(row.boylam), socketClaims: row.soketler.length,
      google: { status: 'not_run', reason: 'credentials_and_access_required', matched: null,
        availabilityFieldsPresent: null, usableTimestampPresent: null },
      here: { status: 'not_run', reason: 'credentials_and_ev_product_access_required', matched: null,
        availabilityFieldsPresent: null, usableTimestampPresent: null } });
  }
  await writeFile(resolve(root, 'docs/validation/task8-station-sample.json'), JSON.stringify({
    schemaVersion: 1, selectedAt: new Date().toISOString(), sourceRetrievedAt, sourceSha256,
    selection: '8 public DC locations per exact normalized EPDK brand; SHA256 order and city diversity; convenience sample, not representative of national coverage',
    stations: selected,
  }, null, 2) + '\n');
  return selected.length;
}
main().catch(e => { console.error(e.code ?? e.name); process.exitCode = 1; });
