// Exercise the shipped double-click entry in isolated folders. The invoked fixture
// script substitutes registration; verify-mvp-installer executes the real installer.
import assert from 'node:assert/strict';
import { createHash, createPublicKey } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';

const archive=unzipSync(fs.readFileSync('dist/G2B_Helper_MVP.zip'));
const source=fs.readFileSync('scripts/install-mvp.cmd','utf8').replace(/\r?\n/g,'\r\n');
const identity=JSON.parse(fs.readFileSync('scripts/mvp-extension-key.json','utf8'));
const manifest=JSON.parse(Buffer.from(archive['mvp-extension/manifest.json']).toString('utf8'));
const checks=[];
function check(name,fn){fn();checks.push(name);console.log('PASS '+name);}
check('ZIP includes the exact double-click entry and current installer',()=>{
 assert.equal(Buffer.from(archive['설치.cmd']).toString('utf8'),source);
 assert.deepEqual(Buffer.from(archive['mvp-host/install-mvp-host.ps1']),fs.readFileSync('scripts/install-mvp-host.ps1'));
});
check('fixed public key produces the expected ID regardless of extracted directory',()=>{
 assert.equal(manifest.key,identity.key);
 const der=Buffer.from(manifest.key,'base64');
 assert.equal(createPublicKey({key:der,format:'der',type:'spki'}).asymmetricKeyType,'rsa');
 const id=createHash('sha256').update(der).digest('hex').slice(0,32).replace(/[0-9a-f]/g,n=>String.fromCharCode(97+parseInt(n,16)));
 assert.equal(id,identity.id);assert.match(id,/^[a-p]{32}$/);
});
check('entry asks for neither IDs nor a policy bypass and guide distinguishes first browser load',()=>{
 assert.match(source,/-NoProfile -NonInteractive -File "%~dp0mvp-host\\install-mvp-host.ps1"/);
 assert.doesNotMatch(source,/ExecutionPolicy|ExtensionId|Set-ExecutionPolicy|reg add/i);
 const guide=Buffer.from(archive['설치안내.txt']).toString('utf8');
 assert.match(guide,/설치\.cmd/);assert.match(guide,/ID 복사와 명령 입력 없이/);
 assert.match(guide,/최초 브라우저 추가는 수동/);assert.match(guide,/새 ID/);
});

const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'g2b-entry-'));
let fixtureNumber=0;
function invoke({missing=false,failure=false}={}){
 const folder=path.join(temporary,`설치 경로 & (검증)! ${++fixtureNumber}`);
 fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'설치.cmd'),source);
 const result=path.join(folder,'invocation.json');
 if(!missing){
  fs.mkdirSync(path.join(folder,'mvp-extension'));fs.writeFileSync(path.join(folder,'mvp-extension/manifest.json'),JSON.stringify(manifest));
  fs.mkdirSync(path.join(folder,'mvp-host'));
  fs.writeFileSync(path.join(folder,'mvp-host/install-mvp-host.ps1'),'\uFEFF'+
   '$ErrorActionPreference = "Stop"\r\n'+
   '@{ arguments = @($args); script = $PSCommandPath } | ConvertTo-Json | Set-Content -LiteralPath $env:G2B_ENTRY_TEST_RESULT -Encoding UTF8\r\n'+
   (failure?'[Console]::Error.WriteLine("synthetic registration failure"); exit 3\r\n':'exit 0\r\n'));
 }
 const executable=path.join(process.env.SystemRoot,'System32/cmd.exe');
 const run=spawnSync(executable,['/d','/s','/c',`""${path.join(folder,'설치.cmd')}""`],{
  cwd:temporary,env:{...process.env,G2B_ENTRY_TEST_RESULT:result},input:'\r\n',encoding:'utf8',
  windowsHide:true,windowsVerbatimArguments:true,timeout:15000
 });
 assert.ifError(run.error);
 return {...run,folder,called:fs.existsSync(result)?JSON.parse(fs.readFileSync(result,'utf8').replace(/^\uFEFF/,'')):null};
}
try {
 check('double-click command resolves a Korean spaced path from another working directory',()=>{
  const result=invoke();assert.equal(result.status,0,result.stderr+'\n'+result.stdout);
  assert.deepEqual(result.called.arguments,[]);
  assert.equal(result.called.script,path.join(result.folder,'mvp-host/install-mvp-host.ps1'));
  assert.match(result.stdout,/Native connection registered/);
 });
 check('a failed registration exits unsuccessfully without printing completion',()=>{
  const result=invoke({failure:true});assert.equal(result.status,1);
  assert.match(result.stderr,/synthetic registration failure/);assert.match(result.stdout,/Registration failed/);
  assert.doesNotMatch(result.stdout,/Native connection registered/);
 });
 check('an incomplete extraction fails before invoking any installer',()=>{
  const result=invoke({missing:true});assert.equal(result.status,1);assert.equal(result.called,null);
  assert.match(result.stdout,/Extract the entire ZIP/);
 });
} finally {
 assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir())+path.sep));
 fs.rmSync(temporary,{recursive:true,force:true});
}
fs.mkdirSync('artifacts/mvp-improvements/installer',{recursive:true});
fs.writeFileSync('artifacts/mvp-improvements/installer/entry.json',JSON.stringify({passed:true,checks,extensionId:identity.id,limitation:'Real command entry; isolated substitute registration script. Real installer is tested separately with mocked registry. Actual browser installation and registry writes not performed.'},null,2));
console.log('Verified double-click installation entry: '+checks.length+' checks');
