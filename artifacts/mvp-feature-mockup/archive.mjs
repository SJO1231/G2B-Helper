import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const destination='artifacts/mvp-feature-mockup/history/F40-before-F41';
const files=['artifacts/mvp-feature-mockup/index.html','artifacts/mvp-feature-mockup/verify.mjs','docs/process/P00.md'];
const digest=b=>createHash('sha256').update(b).digest('hex');
fs.mkdirSync(destination,{recursive:true});
const entries=files.map(file=>{
 const bytes=fs.readFileSync(file),target=path.join(destination,path.basename(file));
 if(fs.existsSync(target))assert.equal(digest(fs.readFileSync(target)),digest(bytes),'Existing archive differs: '+file);
 else fs.writeFileSync(target,bytes,{flag:'wx'});
 assert.equal(digest(fs.readFileSync(target)),digest(bytes));
 return {file,target,sha256:digest(bytes)};
});
const manifest=path.join(destination,'preservation.json');
if(!fs.existsSync(manifest))fs.writeFileSync(manifest,JSON.stringify({kind:'F40 HTML bytes before redo; P00 includes F41 authorization',entries},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({archived:entries.length,unchanged:true}));
