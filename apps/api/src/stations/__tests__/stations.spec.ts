import { normalizeEpdk } from '../epdk-normalizer';
import { stationCandidateSetSchema,stationImportPackageSchema } from '@chargeroad/shared';
import { epdkBytes,epdkRow,stationPackage } from './fixtures';
import { stationSet } from '../../planning/__tests__/fixtures';

describe('EPDK station normalization and source boundaries',()=>{
  it('preserves real connector identities without inventing EVSE grouping or availability',()=>{
    const p=normalizeEpdk(epdkBytes());
    expect(p.records[0].station.evses).toEqual([]);
    expect(p.records[0].connectorClaims[0]).toMatchObject({sourceConnectorId:'SKT/ŞRJ/test',standard:'other',rawType:'DC_CCS',maxPowerKw:150});
    expect(p.records[0].warnings).toContain('connector_subtype_unverified:DC_CCS');
    expect(p.scope.geographicCoverageVerified).toBe(false);
  });
  it('distinguishes known private access from unknown access',()=>{
    const row=epdkRow();row.hizmetSekli='OZEL';
    expect(normalizeEpdk(epdkBytes([row])).records[0].station.access.publicAccess).toBe(false);
    row.hizmetSekli='unrecognized';
    expect(normalizeEpdk(epdkBytes([row])).records[0].station.access.publicAccess).toBeNull();
  });
  it('quarantines bad coordinates instead of swapping latitude and longitude',()=>{
    const p=normalizeEpdk(epdkBytes([epdkRow('valid'),epdkRow('bad',0,0)]));
    expect(p.records).toHaveLength(1);expect(p.quarantine).toHaveLength(1);
    // Empty complete snapshots must not erase an existing country catalogue.
    expect(()=>normalizeEpdk(epdkBytes([epdkRow('bad',0,0)]))).toThrow('Empty complete');
  });
  it('rejects truncated/errored responses and duplicate source identity',()=>{
    const data=JSON.parse(epdkBytes().toString());data.numRows=2;
    expect(()=>normalizeEpdk(Buffer.from(JSON.stringify(data)))).toThrow('count');
    expect(()=>normalizeEpdk(Buffer.from(JSON.stringify({...data,statusCode:500})))).toThrow();
    expect(()=>normalizeEpdk(epdkBytes([epdkRow(),epdkRow()]))).toThrow('Duplicate');
  });
  it('keeps nearby distinct stations distinct at normalization',()=>{
    expect(normalizeEpdk(epdkBytes([epdkRow('one'),epdkRow('two')])).records).toHaveLength(2);
  });
  it('does not let a search cap or missing geographic coverage claim completeness',()=>{
    const result=stationSet();result.metadata.search.truncated=true;
    expect(stationCandidateSetSchema.safeParse(result).success).toBe(false);
    result.metadata.search.truncated=false;result.metadata.coverage.sources[0].geographicCoverageVerified=false;
    expect(stationCandidateSetSchema.safeParse(result).success).toBe(false);
  });
  it('requires explicit bounds when an importer claims geographically verified coverage',()=>{
    const p=stationPackage();p.data.scope.coverageBounds=null;
    expect(stationImportPackageSchema.safeParse(p.data).success).toBe(false);
  });
});
