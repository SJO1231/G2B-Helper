import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd(), failures=[];
function walk(dir){if(!fs.existsSync(dir))return [];return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const sources=walk(path.join(root,'plugins')).filter(p=>/\.[jt]sx?$/.test(p)&&!p.includes('.test.'));
for(const source of sources){
  const owner=path.relative(path.join(root,'plugins'),source).split(path.sep)[0];
  const text=fs.readFileSync(source,'utf8');
  for(const match of text.matchAll(/(?:from\s*|import\s*\()(['"])([^'"]+)\1/g)){
    if(!match[2].startsWith('.'))continue;
    const resolved=path.resolve(path.dirname(source),match[2]);
    if(resolved.startsWith(path.join(root,'native')))failures.push(`${source}: frontend imports native internals`);
    if(!resolved.startsWith(path.join(root,'plugins')+path.sep))continue;
    const parts=path.relative(path.join(root,'plugins'),resolved).split(path.sep);
    if(parts[0]!==owner&&parts.length>1&&!['index','api','gateway'].includes(path.basename(resolved).replace(/\.[jt]sx?$/,''))) failures.push(`${source}: private cross-plugin import ${match[2]}`);
  }
}
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}else console.log(`플러그인 경계 검사 통과 (${sources.length}개 파일)`);
