import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
const manifest=JSON.parse(await readFile('apps/extension/manifest.json','utf8'));
if(manifest.side_panel||manifest.action.default_popup)throw Error('Daily entry must be the page widget, not a permanent workbench.');
const result=await build({entryPoints:['apps/extension/feature.tsx','apps/extension/widget.ts','apps/extension/background.ts'],bundle:true,write:false,outdir:'unused-check',metafile:true,loader:{'.css':'empty'},logLevel:'silent'});
for(const file of Object.keys(result.metafile.inputs)){
 if(file.startsWith('node_modules/'))continue;
 const text=await readFile(file,'utf8');
 if(/\bindexedDB\s*\.|\blocalStorage\s*\./.test(text))throw Error('Browser business storage entered active extension graph: '+file);
 if(/apps\/bookmarklet\/(storage|shell|main)\./.test(file))throw Error('Historical bookmarklet runtime entered active graph: '+file);
}
console.log('확장 경계 검사 통과: 실제 번들 입력 '+Object.keys(result.metafile.inputs).length+'개, IndexedDB/localStorage 저장 없음, 페이지 위젯 진입점.');
