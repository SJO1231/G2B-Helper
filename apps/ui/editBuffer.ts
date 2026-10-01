import type {RecordRow} from './Grid';
/** A visible Grid projection never owns rows that were hidden by presentation options. */
export function mergeGridEdits(previous:RecordRow[],visible:RecordRow[],deletedIds:string[]=[]):RecordRow[]{
 const removed=new Set(deletedIds);const incoming=new Map(visible.map(row=>[row.__rowId,row]));
 const result=previous.filter(row=>!removed.has(row.__rowId)).map(row=>({...row,...incoming.get(row.__rowId)}));
 const existing=new Set(previous.map(row=>row.__rowId));
 return [...result,...visible.filter(row=>!existing.has(row.__rowId)&&!removed.has(row.__rowId))].map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>!key.startsWith('__virtual'))));
}
