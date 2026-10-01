import {request} from '../../plugins/core/gateway';
import type {DocumentStore} from '../shared/document-store';
import {validateHwpxTemplate,validateResolvedHwpxTemplate,resolveHwpxTemplate,type HwpxTemplate} from '../../plugins/hwpx/index';
import {validateTemplateProgram} from '../../plugins/template/index';
export const sqlDocuments:DocumentStore={
  listDocuments:namespace=>request('extension.document.list',{namespace}),
  async putDocument(namespace,documentId,storeVersion,value,expectedReferences){
    // Validate and send one immutable snapshot even if the caller edits while
    // the reference list is being fetched from Native Messaging.
    value=structuredClone(value);
    expectedReferences=expectedReferences?structuredClone(expectedReferences):undefined;
    let expectedDocumentIds:string[]|undefined;
    if(namespace==='hwpx-templates'){
      validateHwpxTemplate(value as HwpxTemplate);
      const entries=await sqlDocuments.listDocuments<HwpxTemplate>(namespace),candidate={namespace,documentId,storeVersion:storeVersion??0,value:value as HwpxTemplate};
      for(const reference of expectedReferences??[])if(entries.find(entry=>entry.documentId===reference.documentId)?.storeVersion!==reference.storeVersion)throw new Error('참조 템플릿이 변경되었습니다. 다시 열어 비교하세요.');
      expectedDocumentIds=entries.map(entry=>entry.documentId);
      const graph=[...entries.filter(entry=>entry.documentId!==documentId),candidate];
      for(const entry of graph)validateResolvedHwpxTemplate(resolveHwpxTemplate(entry.documentId,graph).template);
      expectedReferences=entries.filter(entry=>entry.documentId!==documentId).map(entry=>({documentId:entry.documentId,storeVersion:entry.storeVersion}));
    }
    if(namespace==='templates'){
      const template=value as {name?:unknown;body?:unknown;program?:unknown};
      if(!template||typeof template.name!=='string'||!template.name.trim()||typeof template.body!=='string')throw new Error('텍스트 템플릿의 이름과 본문을 확인하세요.');
      if(template.program!==undefined)validateTemplateProgram(template.program as Parameters<typeof validateTemplateProgram>[0]);
    }
    return request('extension.document.put',{namespace,documentId,storeVersion,value,expectedReferences,expectedDocumentIds});
  },
  removeDocument:async(namespace,documentId,storeVersion)=>{await request('extension.document.remove',{namespace,documentId,storeVersion});}
};
