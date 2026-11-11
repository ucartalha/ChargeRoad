const {resolve}=require('node:path');
const {spawnSync}=require('node:child_process');
require('dotenv').config({path:resolve(__dirname,'../../../.env'),quiet:true});
const database=process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if(!database) throw new Error('TEST_DATABASE_URL or local DATABASE_URL is required');
// Suites create uniquely named schemas and only clean up their own schema.
const result=spawnSync(process.execPath,[require.resolve('jest/bin/jest'),'--runInBand',...process.argv.slice(2)],
  {stdio:'inherit',env:{...process.env,TEST_DATABASE_URL:database}});
if(result.error) throw result.error;
process.exitCode=result.status ?? 1;
