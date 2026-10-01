import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {zipSync,unzipSync,strToU8} from 'fflate';
import assert from 'node:assert/strict';

const directory='dist/bookmarklet',sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const javascript=await readFile(directory+'/pce-bookmarklet.js'),bookmarklet=await readFile(directory+'/pce-bookmarklet.txt','utf8');
assert.equal(decodeURIComponent(bookmarklet.slice('javascript:'.length)),javascript.toString('utf8'),'bookmark URL must contain the exact built bundle');
assert.ok(bookmarklet.startsWith('javascript:'));
for(const name of ['install.html','demo.html']){
  const html=await readFile(directory+'/'+name,'utf8'),url=/href="(javascript:[^"]+)"/.exec(html)?.[1];
  assert.equal(url,bookmarklet,'installer and demo must carry the same bookmark URL');
}
const reports=['bookmarklet-prototype-verification.json','bookmarklet-hwpx-verification.json','bookmarklet-hwpx-insertion-verification.json'];
const checks=[];
for(const name of reports){const report=JSON.parse(await readFile('artifacts/'+name,'utf8'));assert.equal(report.bookmarkletSha256,sha256(javascript),'rerun '+name+' against this bundle before packaging');assert.deepEqual(report.errors,[]);assert.ok(report.finishedAt&&!report.failure);checks.push({report:name,count:report.checks.length,finishedAt:report.finishedAt});}
await copyFile('docs/BOOKMARKLET.md',directory+'/README.md');
await copyFile('docs/BOOKMARKLET_REQUIREMENTS_MATRIX.md',directory+'/REQUIREMENTS_STATUS.md');
await copyFile('docs/TEST_REPORT.md',directory+'/TEST_REPORT.md');
const names=['install.html','demo.html','pce-bookmarklet.txt','pce-bookmarklet.js','README.md','REQUIREMENTS_STATUS.md','TEST_REPORT.md','THIRD_PARTY_NOTICES.txt'],entries={},files=[];
for(const name of names){const bytes=await readFile(directory+'/'+name);entries[name]=bytes;files.push({name,bytes:bytes.length,sha256:sha256(bytes)});}
const manifest={format:'pce-bookmarklet-release',version:1,builtAt:new Date().toISOString(),bookmarkletSha256:sha256(javascript),checks,files,limits:['Actual G2B CSP and bookmark toolbar retention are unverified.','HWPX structure/ZIP checks do not prove Hangul page rendering.','This prototype does not complete all product requirements.']};
const manifestBytes=strToU8(JSON.stringify(manifest,null,2));entries['release-manifest.json']=manifestBytes;await writeFile(directory+'/release-manifest.json',manifestBytes);
const archive=zipSync(entries,{level:6,mtime:new Date(1980,0,1)}),reopened=unzipSync(archive);
for(const [name,bytes]of Object.entries(entries))assert.equal(sha256(reopened[name]),sha256(bytes),'packaging must preserve '+name);
const output='dist/PCE-bookmarklet-prototype.zip';await writeFile(output,archive);assert.equal(sha256(await readFile(output)),sha256(archive));
await mkdir('artifacts',{recursive:true});
const evidence={finishedAt:new Date().toISOString(),output,bytes:archive.length,sha256:sha256(archive),entries:Object.keys(entries).length,bookmarkletSha256:manifest.bookmarkletSha256,checks,verified:true};
await writeFile('artifacts/bookmarklet-package-verification.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
