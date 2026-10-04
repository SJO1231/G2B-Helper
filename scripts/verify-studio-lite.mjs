// Execute the existing sibling project's checks; this is not a second build system.
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const studio=path.resolve(root,'../Hwpx Studio lite');
const out=path.join(root,'artifacts/document-bridge');mkdirSync(out,{recursive:true});
const files=['src/g2b.ts','src/server.ts','test/g2b.test.ts','web/app.js','web/index.html'];
const hashes=Object.fromEntries(files.map(f=>[f,createHash('sha256').update(readFileSync(path.join(studio,f))).digest('hex')]));
const npm=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
const run=spawnSync(process.execPath,[npm,'run','verify'],{cwd:studio,encoding:'utf8',windowsHide:true,timeout:230000,maxBuffer:8*1024*1024});
const output=(run.stdout||'')+(run.stderr||'');process.stdout.write(output);
const count=Number(output.match(/(?:#|ℹ) tests (\d+)/u)?.[1]||0);
const passed=run.status===0&&count>0&&/(?:#|ℹ) fail 0\b/u.test(output)&&/(?:#|ℹ) skipped 0\b/u.test(output)&&/(?:#|ℹ) cancelled 0\b/u.test(output);
writeFileSync(path.join(out,'studio-verify.json'),JSON.stringify({passed,count,exit:run.status,hashes,limitation:'Sibling project verification; runtime installation and real business acceptance are separate.'},null,2));
if(!passed)throw new Error('Studio verification failed or ran zero tests: '+(run.error||run.status));
console.log('Studio existing verify passed: '+count+' tests');
