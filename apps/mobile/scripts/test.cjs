// Compile only pure TS modules for Node tests; no React Native mocks or device claims.
const fs=require('node:fs');
const ts=require('typescript');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:filename}).outputText,filename);
require('../tests/planning-flow.test.cjs');
require('../tests/trip-summary.test.cjs');
require('../tests/navigation.test.cjs');
require('../tests/navigation-index-proof.test.cjs');
require('../tests/navigation-view.test.cjs');
require('../tests/navigation-heading.test.cjs');
require('../tests/dev-log.test.cjs');
require('../tests/soc-feedback.test.cjs');
