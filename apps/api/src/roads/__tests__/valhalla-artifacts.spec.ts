import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
it('keeps Valhalla graph/DEM artifacts out of Git while keeping infrastructure sources reviewable',()=>{
 const paths=['infra/valhalla/elevation-pilot/elevation_data/N39E032.hgt','infra/valhalla/elevation-pilot/valhalla_tiles.tar',
  'infra/valhalla/custom_files/turkey.osm.pbf','infra/valhalla/datasets/staging/valhalla_tiles/2/000.gph',
  'infra/valhalla/other/test.hgt.gz','infra/valhalla/README.md','infra/valhalla/compose.dem.yaml','infra/valhalla/manifest.example.json'];
 const result=spawnSync('git',['check-ignore','--no-index','--stdin'],{cwd:resolve(__dirname,'../../../../..'),encoding:'utf8',input:paths.join('\n')+'\n'});
 if(result.error)throw result.error;expect(result.status).toBe(0);
 expect(result.stdout.trim().split(/\r?\n/)).toEqual(paths.slice(0,5));
});
