import { describe,expect,it } from 'vitest';
import { zipSync,strToU8 } from 'fflate';
import { inspectHwpxZip,base64ToBytes,bytesToBase64,resolveHwpxTemplate,type HwpxTemplate } from '../plugins/hwpx/index';
import { defaultTemplateProgram } from '../plugins/template/index';

const zip=(entries:Record<string,Uint8Array>)=>zipSync(entries,{level:0});
describe('HWPX archive and derived references',()=>{
  it('checks names, sizes and uncompressed mimetype before inflate',()=>{
    const bytes=zip({mimetype:strToU8('application/hwp+zip'),'Contents/section0.xml':strToU8('<sec/>')});
    expect(inspectHwpxZip(bytes).map(entry=>entry.name)).toEqual(['mimetype','Contents/section0.xml']);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
  it('rejects traversal, duplicate entries, bad order and corrupt central data',()=>{
    expect(()=>inspectHwpxZip(zip({mimetype:strToU8('application/hwp+zip'),'../bad':strToU8('bad')}))).toThrow('경로');
    expect(()=>inspectHwpxZip(zip({other:strToU8('x'),mimetype:strToU8('application/hwp+zip')}))).toThrow('첫 항목');
    const bytes=zip({mimetype:strToU8('application/hwp+zip'),abc:strToU8('x'),def:strToU8('y')}),copy=bytes.slice();
    for(let index=0;index<copy.length-3;index++)if(copy[index]===100&&copy[index+1]===101&&copy[index+2]===102)copy.set(strToU8('abc'),index);
    expect(()=>inspectHwpxZip(copy)).toThrow('반복');
    expect(()=>inspectHwpxZip(bytes.slice(0,-1))).toThrow('끝 정보');
  });
  it('rejects forged expanded lengths before decompression',()=>{
    const bytes=zip({mimetype:strToU8('application/hwp+zip'),'Contents/section0.xml':strToU8('<sec/>')}),view=new DataView(bytes.buffer);let changed=false;
    for(let offset=0;offset<bytes.length-46;offset++)if(view.getUint32(offset,true)===0x02014b50&&view.getUint32(offset+24,true)===6){view.setUint32(offset+24,21*1024*1024,true);changed=true;break;}
    expect(changed).toBe(true);expect(()=>inspectHwpxZip(bytes)).toThrow('크기');
  });
  it('merges derived overrides without copying the master archive',()=>{
    const target={id:'s#0',part:'s',path:[0],kind:'paragraph' as const,text:'old',writable:true},anchor={id:'a',name:'a',target,expression:'{code}'},master:HwpxTemplate={name:'Master',filename:'x.hwpx',masterZip:'zip',anchors:[anchor],program:defaultTemplateProgram()};
    const entries=[{documentId:'m',storeVersion:1,value:master},{documentId:'d',storeVersion:2,value:{...master,name:'Derived',masterZip:undefined,baseTemplateId:'m',anchors:[{...anchor,expression:'{name}'}]}}];
    const result=resolveHwpxTemplate('d',entries);expect(result.template.masterZip).toBe('zip');expect(result.template.anchors[0].expression).toBe('{name}');expect(result.versions).toBe('d:2|m:1');
    expect(entries[1].value.masterZip).toBeUndefined();expect(entries[0].value.anchors[0].expression).toBe('{code}');
  });
  it('rejects missing and cyclic derived references',()=>{
    const value:HwpxTemplate={name:'a',filename:'x.hwpx',baseTemplateId:'b',anchors:[],program:defaultTemplateProgram()};
    expect(()=>resolveHwpxTemplate('a',[{documentId:'a',storeVersion:1,value}])).toThrow('원본이 없습니다');
    expect(()=>resolveHwpxTemplate('a',[{documentId:'a',storeVersion:1,value},{documentId:'b',storeVersion:2,value:{...value,baseTemplateId:'a'}}])).toThrow('순환');
  });
});
