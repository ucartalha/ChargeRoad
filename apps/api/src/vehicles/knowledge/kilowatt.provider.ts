import { createHash } from 'node:crypto';
import { z } from 'zod';
import { downloadVehicleSource } from '../import/open-ev.provider';

export class KilowattDataProvider {
  async fetchSnapshot(version='latest',signal?:AbortSignal){
    if(version!=='latest' && !/^[a-f0-9]{40}$/.test(version))throw new Error('Kilowatt version must be latest or a full commit SHA');
    const commit=z.object({sha:z.string().regex(/^[a-f0-9]{40}$/)}).parse(JSON.parse(Buffer.from(await downloadVehicleSource(
      'https://api.github.com/repos/KilowattApp/open-ev-data/commits/'+(version==='latest'?'master':version),1000000,signal)).toString('utf8'))).sha;
    if(version!=='latest' && commit!==version)throw new Error('Kilowatt commit mismatch');
    const base=`https://raw.githubusercontent.com/KilowattApp/open-ev-data/${commit}/`;
    const license=await downloadVehicleSource(base+'LICENSE',64000,signal);
    // Matches the retained third_party/kilowatt-open-ev-data.LICENSE.md. Changes require review.
    if(createHash('sha256').update(license).digest('hex')!=='09dff130fd847b55f28ca2b9914460445215145fdc4b9dd084eff2952113f18a')
      throw new Error('Kilowatt usage terms changed; source review required');
    const url=base+'data/ev-data.json';
    const bytes=Buffer.from(await downloadVehicleSource(url,16*1024*1024,signal));
    return {bytes,manifest:{commit,sha256:createHash('sha256').update(bytes).digest('hex'),url,retrievedAt:new Date().toISOString()}};
  }
}
