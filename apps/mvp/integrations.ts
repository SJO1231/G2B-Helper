import type { DocumentItem, ExtractionView, JsonRow, ProcurementObservation, ProcurementRecord, ProcurementStage } from './contracts';
import type { RecordView } from './record-view';
export interface CollectorBridge { sendCollectedData(payload:ProcurementObservation[]):Promise<void>; }
export const collectorBridge:CollectorBridge={async sendCollectedData(payload){window.dispatchEvent(new CustomEvent('g2b-helper:collected',{detail:structuredClone(payload)}));}};

/** Use the recognizer's resolved parents, including child tables and frame provenance. */
export function screenDocumentItems(observations:ProcurementObservation[]):DocumentItem[]{
 return observations.map(({stage,identity,fields,children,source})=>structuredClone({stage,identity,fields,userValues:{},children,source}));
}

/** Use source values, never labels or the flattened display/export projection. */
export function documentItems(selected:{sourceIndex:number;row:JsonRow}[], context:{kind:'db';records:ProcurementRecord[];recordIds:string[];view:RecordView}|{kind:'screen';view:ExtractionView;stage:ProcurementStage}):DocumentItem[]{
 if(!selected.length)throw new Error('생성할 자료를 선택하세요.');
 return selected.map(({sourceIndex,row})=>{
  if(context.kind==='db'){
   const record=context.records.find(r=>r.recordId===context.recordIds[sourceIndex]);
   if(!record)throw new Error('선택한 업무 자료가 바뀌었습니다. 다시 선택하세요.');
   const snapshot=context.view.toEdit(record,row);
   return structuredClone({stage:record.stage,identity:record.identity,fields:snapshot.fields,userValues:snapshot.userValues,children:record.children,source:record.source});
  }
  const keys={receipt:['ctrtDmndRcptNo','ctrtDmndRcptOrd'],bid:['bidPbancNo','bidPbancOrd'],contract:['ctrtNo','ctrtChgOrd']}[context.stage];
  return structuredClone({stage:context.stage,identity:keys.map(key=>String(row[key]??'')),fields:row,userValues:{},children:[],source:{...context.view.source,tableKey:context.view.key,tableLabel:context.view.label}});
 });
}
