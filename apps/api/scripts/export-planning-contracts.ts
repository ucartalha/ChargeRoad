import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {z} from 'zod';
import {planningApiRequestSchema,planningApiResponseSchema,planningApiErrorSchema} from '@chargeroad/shared';
async function main(){
  const directory=resolve(__dirname,'../../../docs/api');await mkdir(directory,{recursive:true});
  for(const [name,schema,io] of [['planning-request',planningApiRequestSchema,'input'],['planning-response',planningApiResponseSchema,'output'],['planning-error',planningApiErrorSchema,'output']] as const){
    await writeFile(resolve(directory,name+'.schema.json'),JSON.stringify(z.toJSONSchema(schema,{target:'draft-2020-12',io}),null,2)+'\n');console.log(name+'.schema.json');
  }
}
void main().catch((e:unknown)=>{console.error(e instanceof Error?e.message:'Contract export failed');process.exitCode=1;});
