import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { KilowattDataProvider } from '../knowledge/kilowatt.provider';
import { parseKilowattSnapshot } from '../knowledge/kilowatt-staging';

export function sourceFixture(){
  const bytes=Buffer.from(JSON.stringify({meta:{updated_at:'2026-01-01T00:00:00Z',overall_count:1},brands:[],
    data:[{id:'test-source-car',brand:'Synthetic',model:'Test EV',release_year:2025,
      energy_consumption:{average_consumption:20},dc_charger:{is_default_charging_curve:true}}]}));
  const commit='a'.repeat(40);
  return {bytes,manifest:{commit,url:`https://raw.githubusercontent.com/KilowattApp/open-ev-data/${commit}/data/ev-data.json`,
    sha256:createHash('sha256').update(bytes).digest('hex'),retrievedAt:'2026-01-02T00:00:00Z'}};
}
describe('Licensed source download and global candidate review',()=>{
  afterEach(()=>jest.restoreAllMocks());
  it('downloads an immutable commit, verifies usage terms and retains generic-curve flags',async()=>{
    const f=sourceFixture();
    const license=readFileSync(resolve(__dirname,'../../../../../third_party/kilowatt-open-ev-data.LICENSE.md'));
    const fetch=jest.spyOn(global,'fetch').mockResolvedValueOnce(new Response(JSON.stringify({sha:f.manifest.commit})))
      .mockResolvedValueOnce(new Response(license)).mockResolvedValueOnce(new Response(f.bytes));
    const snapshot=await new KilowattDataProvider().fetchSnapshot(f.manifest.commit);
    const parsed=parseKilowattSnapshot(snapshot.bytes,snapshot.manifest);
    expect(parsed.report.genericChargingCurves).toBe(1);
    expect(parsed.candidates[0].review_flags).toContain('generic_charging_curve');
    expect(parsed.report.acceptedSpeedTests).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('stops if the upstream license changes',async()=>{
    const fetch=jest.spyOn(global,'fetch').mockResolvedValueOnce(new Response(JSON.stringify({sha:'a'.repeat(40)})))
      .mockResolvedValueOnce(new Response('changed license'));
    await expect(new KilowattDataProvider().fetchSnapshot()).rejects.toThrow('usage terms changed');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('rejects mutable branch names and mismatched commit responses',async()=>{
    await expect(new KilowattDataProvider().fetchSnapshot('master')).rejects.toThrow('full commit');
    jest.spyOn(global,'fetch').mockResolvedValueOnce(new Response(JSON.stringify({sha:'b'.repeat(40)})));
    await expect(new KilowattDataProvider().fetchSnapshot('a'.repeat(40))).rejects.toThrow('commit mismatch');
  });
  it('rejects tampered snapshots, foreign URLs and repeated identities',()=>{
    const f=sourceFixture();
    expect(()=>parseKilowattSnapshot(Buffer.from('changed'),f.manifest)).toThrow('checksum');
    expect(()=>parseKilowattSnapshot(f.bytes,{...f.manifest,url:'https://example.invalid/data.json'})).toThrow('URL');
    const data=JSON.parse(f.bytes.toString('utf8'));data.meta.overall_count=2;data.data.push(data.data[0]);
    const bytes=Buffer.from(JSON.stringify(data));
    expect(()=>parseKilowattSnapshot(bytes,{...f.manifest,sha256:createHash('sha256').update(bytes).digest('hex')})).toThrow('identity');
  });
});
