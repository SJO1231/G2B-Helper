import type { JsonRow, MvpSettings, ProcurementRecord, ProcurementStage } from './contracts';
import { contractUserColumns, withContractValues } from './user-fields';
const derived = new Set(['지체일수','미종결금액']);

/** A display projection never becomes a persisted source record. Each owner keeps its key map. */
export class RecordView {
 readonly sourceKeys:Set<string>;
 readonly userNames=new Map<string,string>();
 readonly childNames=new Map<string,string>();
 readonly rawKey:string;
 constructor(records:ProcurementRecord[],readonly stage:ProcurementStage,private settings:MvpSettings){
  this.sourceKeys=new Set(records.flatMap(r=>Object.keys(r.fields)));
  const used=new Set(this.sourceKeys);
  const allocate=(name:string,prefix:string)=>{let key=used.has(name)?prefix+' · '+name:name;const base=key;let n=2;while(used.has(key))key=base+' '+n++;used.add(key);return key;};
  const definitions=settings.userColumns?.[stage]??records.flatMap(r=>Object.keys(r.userValues));
  for(const name of new Set([...definitions,...(stage==='contract'?contractUserColumns:[])]))this.userNames.set(name,allocate(name,'사용자'));
  for(const record of records)for(const child of record.children)if(!this.childNames.has(child.key))this.childNames.set(child.key,allocate(child.label||child.key,'표'));
  this.rawKey=allocate('원본 JSON','수집');
 }
 get userKeys(){return [...this.userNames.values()];}
 // Source values are read only; only user columns are edited (user, 2026-10-09, #42).
 get readonlyKeys(){return[this.rawKey,...this.childNames.values(),...this.sourceKeys,...[...derived].map(k=>this.userNames.get(k)).filter((k):k is string=>!!k)];}
 get completionKey(){return this.userNames.get('종결')||'종결';}
 toRow(record:ProcurementRecord):JsonRow{
  const row:JsonRow=Object.assign(Object.create(null),structuredClone(record.fields));
  const user=this.stage==='contract'?withContractValues(record.fields,record.userValues,this.settings):record.userValues;
  for(const[name,key]of this.userNames)row[key]=Object.hasOwn(record.userValues,name)||(this.stage==='contract'&&contractUserColumns.includes(name))?user[name]:'';
  for(const child of record.children)row[this.childNames.get(child.key)!]=structuredClone(child.rows);
  row[this.rawKey]=record.rawJson;return row;
 }
 userFromRow(row:JsonRow):JsonRow{
  const values:JsonRow=Object.create(null);const reserved=new Set([...this.sourceKeys,...this.childNames.values(),this.rawKey]);
  for(const[name,key]of this.userNames)if(!derived.has(name)&&Object.hasOwn(row,key))values[name]=row[key];
  for(const[key,value]of Object.entries(row))if(!reserved.has(key)&&!this.userKeys.includes(key)&&!derived.has(key))values[key]=value;
  return values;
 }
 toEdit(record:ProcurementRecord,row:JsonRow){
  // Removing a column definition does not erase values in rows outside the current filter. Source values stay as stored.
  return{recordId:record.recordId,storeVersion:record.storeVersion,fields:structuredClone(record.fields),userValues:{...record.userValues,...this.userFromRow(row)}};
 }
 definitionNames(displayKeys:string[]){return displayKeys.map(key=>[...this.userNames].find(([,alias])=>alias===key)?.[0]||key).filter(name=>!derived.has(name));}
 derive(row:JsonRow):JsonRow{
  if(this.stage!=='contract')return{};
  const fields=Object.fromEntries([...this.sourceKeys].map(key=>[key,row[key]]));const values=withContractValues(fields,this.userFromRow(row),this.settings);
  return Object.fromEntries([...derived].map(name=>[this.userNames.get(name)!,values[name]]));
 }
}
