import {PhotonProvider} from '../photon-provider';
import {GeocodingRegistry,geocodingConfig} from '../geocoding-provider';
const signal=new AbortController().signal;
const feature=(properties:Record<string,unknown>={},coordinates=[29,41])=>({type:'Feature',geometry:{type:'Point',coordinates},properties:{osm_id:123,osm_type:'N',name:'Kadıköy',city:'İstanbul',countrycode:'TR',...properties}});
describe('Replaceable Photon geocoder',()=>{
  it('uses bounded Turkish geography and preserves attribution without exposing provider packets',async()=>{
    const transport=jest.fn().mockResolvedValue(new Response(JSON.stringify({features:[feature()]})));
    const result=await new PhotonProvider('https://example.com/',transport).search('Kadıköy İstanbul',signal);
    const url=transport.mock.calls[0][0] as URL;expect(url.searchParams.get('q')).toBe('Kadıköy İstanbul');expect(url.searchParams.get('limit')).toBe('6');
    expect(url.searchParams.get('bbox')).toBe('25.6,35.8,44.9,42.2');expect(result.results[0]).toEqual({id:'photon:N:123',label:'Kadıköy, İstanbul',coordinate:{latitude:41,longitude:29}});
    expect(result.attribution).toContain('OpenStreetMap');expect(result).not.toHaveProperty('features');
  });
  it('rejects malformed or foreign coordinates and returns an honest empty result',async()=>{
    const packet={features:[feature({countrycode:'DE'}),feature({},[0,0]),{bad:true}]};
    const result=await new PhotonProvider('https://example.com/',async()=>new Response(JSON.stringify(packet))).search('query',signal);expect(result.results).toEqual([]);
  });
  it('does not leak provider errors, follow redirects, or accept unbounded payloads',async()=>{
    const transport=jest.fn().mockResolvedValue(new Response('private upstream detail',{status:429}));
    await expect(new PhotonProvider('https://example.com/',transport).search('query',signal)).rejects.toThrow('Geocoder unavailable');
    expect(transport.mock.calls[0][1].redirect).toBe('error');
    await expect(new PhotonProvider('https://example.com/',async()=>new Response('x'.repeat(270000))).search('query',signal)).rejects.toThrow('response limit');
  });
  it('propagates cancellation to the provider transport',async()=>{
    const abort=new AbortController();abort.abort();
    const transport:typeof fetch=async(_url,options)=>{(options!.signal as AbortSignal).throwIfAborted();throw new Error('unexpected');};
    await expect(new PhotonProvider('https://example.com/',transport).search('query',abort.signal)).rejects.toBeDefined();
  });
  it('selects registered providers independently of the public DTO',()=>{
    const a=new PhotonProvider('https://example.com/'),registry=new GeocodingRegistry([a]);expect(registry.get('photon')).toBe(a);
    expect(()=>registry.get('unregistered')).toThrow();expect(()=>new GeocodingRegistry([a,a])).toThrow();
  });
  it('blocks public demo production usage and rejects credential-bearing endpoint URLs',()=>{
    const original={...process.env};try{process.env.NODE_ENV='production';process.env.GEOCODING_ENABLED='true';process.env.GEOCODING_BASE_URL='https://photon.komoot.io';
      expect(()=>geocodingConfig()).toThrow('production');process.env.GEOCODING_BASE_URL='https://user:password@example.com';expect(()=>geocodingConfig()).toThrow();
    }finally{process.env=original;}
  });
});
