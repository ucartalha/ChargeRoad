import { normalizeEpdk } from '../epdk-normalizer';
export function epdkRow(id='ŞRJ/test',latitude=39.904,longitude=32.8){
  return {sarjIstasyonuNo:id,sarjIstasyonuAdi:'Synthetic station',sarjAgiIsletmecisiLisansNo:'test-operator',
    enlem:latitude,boylam:longitude,hizmetSekli:'HALKA_ACIK',soketler:[
      {soketNo:'SKT/'+id,soketTipi:'DC',soketTuru:'DC_CCS',soketGucu:'150'}]};
}
export function epdkBytes(rows:unknown[]=[epdkRow()]){return Buffer.from(JSON.stringify({statusCode:200,numRows:rows.length,errors:[],data:rows}));}
export function stationPackage(rows:unknown[]=[epdkRow()]){
  const bytes=epdkBytes(rows),data=normalizeEpdk(bytes);
  data.source={key:'synthetic-stations',name:'Synthetic station fixtures',homepageUrl:'https://example.invalid',
    permission:'own_data',permissionReference:'Isolated test fixture only',attribution:'Synthetic tests',license:'TEST-ONLY',priority:10};
  data.scope.geographicCoverageVerified=true;
  data.scope.coverageBounds={minLatitude:39,maxLatitude:41,minLongitude:32,maxLongitude:34};
  return {bytes,data};
}
