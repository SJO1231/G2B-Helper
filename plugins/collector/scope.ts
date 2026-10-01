import type { CapturePayload, CollectionPolicy, CollectionRule, CollectionScope, FilterCondition, FilterGroup } from '../../packages/contracts/src/index';
import { matchesCondition, matchesFilter, validateFilter } from '../core/index';

export const defaultCollectionPolicy: CollectionPolicy = { version: 1, storeVersion: 0, rules: null };
export const approvedScreenProfiles = [
  { stage:'receipt', areaCd:'14', depth1:'01001', depth2:['01114','01117'], identityFields:['ctrtDmndRcptNo','ctrtDmndRcptOrd'] },
  { stage:'bid', areaCd:'14', depth1:'01173', depth2:['01174'], identityFields:['bidPbancNo','bidPbancOrd'] },
  { stage:'contract', areaCd:'14', depth1:'01570', depth2:['01571'], identityFields:['ctrtNo','ctrtChgOrd'] }
] as const;
type Unit = NonNullable<CapturePayload['frames']>[number];
function datasetName(unit:Unit,name:string):string|undefined{
 if(Object.hasOwn(unit.tables,name))return name;
 const names=Object.entries(unit.tableSources??{}).filter(([key,source])=>Object.hasOwn(unit.tables,key)&&(source.componentId===name||source.originalId===name)).map(([key])=>key);
 return names.length===1?names[0]:undefined;
}
type RecordValue = Record<string, unknown>;
const present = (value: unknown): boolean => value !== undefined && value !== null && !(typeof value === 'string' && !value.trim());
const scalarIdentity = (value: unknown): boolean => present(value) && ['string','number','boolean'].includes(typeof value);
const complete = (row:RecordValue, keys:readonly string[]):boolean => keys.every(key=>scalarIdentity(row[key]));
const identity = (row:RecordValue, keys:readonly string[]):string => JSON.stringify(keys.map(key=>String(row[key])));
function stable(value: unknown): string {
  if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  if(value && typeof value==='object') return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable((value as RecordValue)[key])).join(',')+'}';
  return JSON.stringify(value) ?? 'undefined';
}
const conflicts = (left:RecordValue,right:RecordValue):boolean => Object.keys(left).some(key=>Object.hasOwn(right,key)&&present(left[key])&&present(right[key])&&stable(left[key])!==stable(right[key]));
const blocked = (status:CollectionScope['status'], reason:string):CollectionScope => ({allowed:false,status,reason});

function validateExpression(value: unknown, depth=0): asserts value is FilterGroup|FilterCondition {
  if(!value || typeof value!=='object' || Array.isArray(value) || depth>12)throw new Error('화면 조건 형식이 올바르지 않습니다.');
  const expression=value as FilterGroup|FilterCondition;
  if('join' in expression){validateFilter(expression);expression.conditions.forEach(child=>validateExpression(child,depth+1));}
  else {
    validateFilter({join:'and',conditions:[expression]});
    if(expression.compareAs!==undefined&&!['raw','label'].includes(expression.compareAs))throw new Error('비교 모드를 확인하세요.');
    if(expression.path?.some(key=>['__proto__','constructor','prototype'].includes(key)))throw new Error('허용되지 않은 JSON 경로입니다.');
  }
}
/** Accepts the collector.policy JSON exported by the desktop settings screen. */
export function parseCollectionPolicy(value: unknown): CollectionPolicy {
  if(!value || typeof value!=='object' || Array.isArray(value))throw new Error('수집 정책은 JSON 객체여야 합니다.');
  const policy=value as CollectionPolicy;
  if(policy.version!==1||!Number.isSafeInteger(policy.storeVersion)||policy.storeVersion<0||!(policy.rules===null||Array.isArray(policy.rules)))throw new Error('수집 정책 버전 또는 규칙 형식을 확인하세요.');
  for(const rule of policy.rules??[]){
    if(!rule||typeof rule!=='object'||typeof rule.sourceId!=='string'||!rule.sourceId.trim()||typeof rule.dataset!=='string'||!rule.dataset.trim()||!Array.isArray(rule.identityFields)||!rule.identityFields.length||rule.identityFields.some(key=>typeof key!=='string'||!key.trim()||key.startsWith('__'))||new Set(rule.identityFields).size!==rule.identityFields.length||(rule.enabled!==undefined&&typeof rule.enabled!=='boolean'))throw new Error('수집 규칙의 대상 표, Dataset, 식별 열을 확인하세요.');
    if(rule.screenFilter!==undefined&&rule.screenFilter!==null)validateExpression(rule.screenFilter);
    if(rule.urlFilter!==undefined&&rule.urlFilter!==null)validateExpression(rule.urlFilter);
  }
  if(policy.includeDefaults!==undefined&&typeof policy.includeDefaults!=='boolean')throw new Error('기본 수집 조건 포함 여부를 확인하세요.');
  return JSON.parse(JSON.stringify(policy)) as CollectionPolicy;
}
function screenMatches(point:RecordValue, rule:CollectionRule):boolean {
  const filter=rule.screenFilter;
  return !filter || ('join' in filter ? matchesFilter(point,filter) : matchesCondition(point,filter));
}
function approvedDefaultUrl(value:unknown):boolean {
  // URL-less provided captures remain structural fixtures; actual browser frames carry their URL.
  if(value===undefined||value===null||value==='')return true;
  if(typeof value!=='string')return false;
  const supplied=value.trim();if(!supplied)return true;
  try {
    const url=new URL(supplied);
    return ['http:','https:'].includes(url.protocol)&&(url.hostname==='g2b.go.kr'||url.hostname.endsWith('.g2b.go.kr'));
  } catch {return false;}
}
function compose(units:Unit[], payload:CapturePayload):CapturePayload {
  const pointInfo:RecordValue=Object.create(null),tables:CapturePayload['tables']=Object.create(null);
  function add(target:RecordValue,key:string,value:unknown,path:string){
    let name=key,index=2;
    if(Object.hasOwn(target,name))name=path+'::'+key;
    const initial=name;
    while(Object.hasOwn(target,name))name=initial+'#'+index++;
    Object.defineProperty(target,name,{value,enumerable:true,configurable:true});
  }
  for(const unit of units){
    Object.entries(unit.pointInfo).forEach(([key,value])=>add(pointInfo,key,value,unit.framePath));
    Object.entries(unit.tables).forEach(([key,value])=>add(tables,key,value,unit.framePath));
  }
  const warnings=[...new Set([...(payload.warnings??[]),...units.flatMap(unit=>((unit as Unit&{warnings?:string[]}).warnings??[]).map(warning=>'['+unit.framePath+'] '+warning))])];
  return {pointInfo,tables,...(!payload.frames?.length&&units[0]?.tableSources?{tableSources:units[0].tableSources}:{}),...(payload.url!==undefined?{url:payload.url}:{}),...(payload.frames?.length?{frames:units}:{}),warnings};
}

/** Scope is decided before CaptureEvent creation/storage. Aggregated extraction fields never join frames. */
export function evaluateCollectionScope(payload:CapturePayload, suppliedPolicy:CollectionPolicy=defaultCollectionPolicy):CollectionScope {
  let policy:CollectionPolicy;
  try{policy=parseCollectionPolicy(suppliedPolicy);}catch(error){return blocked('invalid_policy',error instanceof Error?error.message:String(error));}
  for(const unit of [payload,...(payload.frames??[])])if(unit.tableSources!==undefined){
    if(!unit.tableSources||typeof unit.tableSources!=='object'||Array.isArray(unit.tableSources)||Object.entries(unit.tableSources).some(([name,source])=>!Object.hasOwn(unit.tables,name)||!source||typeof source.componentId!=='string'||!source.componentId||typeof source.originalId!=='string'||!source.originalId))return blocked('ambiguous','Dataset 출처 메타데이터가 올바르지 않습니다.');
  }
  if(policy.rules!==null&&policy.includeDefaults){
    const base=evaluateCollectionScope(payload,{...policy,rules:null,includeDefaults:false}),custom=evaluateCollectionScope(payload,{...policy,includeDefaults:false});
    if([base,custom].some(scope=>scope.status==='ambiguous'||scope.status==='invalid_policy'))return [base,custom].find(scope=>scope.status==='ambiguous'||scope.status==='invalid_policy')!;
    if(!base.allowed)return custom;if(!custom.allowed)return base;
    const unitsFor=(scope:CollectionScope):Unit[]=>scope.filteredPayload!.frames??[{framePath:'top',url:payload.url??'',...scope.filteredPayload!}];
    const parentContexts=new Set<string>();
    const addParents=(profile:typeof approvedScreenProfiles[number],rows:RecordValue[])=>{
      for(const row of rows.filter(row=>complete(row,profile.identityFields)))parentContexts.add(profile.stage+':'+identity(row,profile.identityFields));
    };
    for(const unit of unitsFor(base)) {
      const profile=approvedScreenProfiles.find(profile=>profile.depth2.some(depth=>depth===String(unit.pointInfo.depth2)));
      if(profile)addParents(profile,[unit.pointInfo,...Object.values(unit.tables).flat()]);
    }
    for(const unit of unitsFor(custom))for(const rule of policy.rules) {
      if(rule.enabled===false||!screenMatches(unit.pointInfo,rule))continue;
      if(rule.urlFilter&&!('join' in rule.urlFilter?matchesFilter({url:unit.url},rule.urlFilter):matchesCondition({url:unit.url},rule.urlFilter)))continue;
      const profile=approvedScreenProfiles.find(profile=>rule.sourceId==='procurement.'+profile.stage||rule.sourceId==='procurement.'+profile.stage+'_item');
      if(!profile)continue;
      const sourceRows=rule.dataset==='$pointInfo'?[unit.pointInfo]:unit.tables[datasetName(unit,rule.dataset)??'']??[];
      const eligible=sourceRows.filter(row=>complete(row,rule.identityFields));
      if(eligible.length)addParents(profile,[unit.pointInfo,...eligible]);
    }
    if(parentContexts.size>1)return blocked('ambiguous','기본 조건과 사용자 규칙이 서로 다른 업무 문맥을 포함합니다.');
    const frames=new Map<string,Unit>();
    for(const scope of [base,custom])for(const unit of unitsFor(scope)) {
      const old=frames.get(unit.framePath);
      // Defaults retain the original frame dataset. A custom subset must not replace it.
      frames.set(unit.framePath,old?{...unit,pointInfo:{...old.pointInfo,...unit.pointInfo},tables:{...unit.tables,...old.tables}}:unit);
    }
    return {allowed:true,status:'allowed',reason:'기본 화면 및 등록 조건을 확인했습니다.',filteredPayload:compose([...frames.values()],payload)};
  }
  const units:Unit[]=payload.frames?.length?payload.frames:[{framePath:'top',url:payload.url??'',pointInfo:payload.pointInfo,tables:payload.tables,tableSources:payload.tableSources}];
  const selected:Unit[]=[];
  const contexts=new Map<string,string>();
  const records=new Map<string,RecordValue>();
  let customProcurementContext:string|undefined;
  let recognized=false;
  let rejectedDefaultUrl=false;
  function record(source:string,keys:readonly string[],row:RecordValue,singleContext=true):boolean {
    const id=identity(row,keys), context=contexts.get(source);
    if(singleContext&&context!==undefined&&context!==id)return false;
    if(singleContext)contexts.set(source,id);
    const key=source+':'+id,previous=records.get(key);
    if(previous&&conflicts(previous,row))return false;
    records.set(key,{...previous,...Object.fromEntries(Object.entries(row).filter(([,value])=>present(value)))});
    return true;
  }
  for(const unit of units){
    const point=unit.pointInfo, rows=Object.values(unit.tables).flat();
    if(policy.rules===null){
      const profile=approvedScreenProfiles.find(profile=>profile.depth2.some(depth=>depth===String(point.depth2)));
      if(!profile||String(point.areaCd)!==profile.areaCd)continue;
      if(!approvedDefaultUrl(unit.url)){rejectedDefaultUrl=true;continue;}
      recognized=true;
      if(String(point.depth1)!==profile.depth1)return blocked('ambiguous','화면 상위 경로와 지정 업무 화면이 일치하지 않습니다.');
      const own=[point,...rows], completeRows=own.filter(row=>complete(row,profile.identityFields));
      if(!completeRows.length)continue;
      const identities=new Set(completeRows.map(row=>identity(row,profile.identityFields)));
      if(identities.size!==1)return blocked('ambiguous','지정 화면에 여러 업무 식별값이 있습니다.');
      const business=completeRows[0];
      if(own.some(row=>profile.identityFields.some(key=>present(row[key])&&String(row[key])!==String(business[key]))))return blocked('ambiguous','화면과 Dataset의 업무 식별값이 충돌합니다.');
      if(contexts.size&&!contexts.has(profile.stage))return blocked('ambiguous','서로 다른 업무 화면이 함께 로딩되어 있습니다.');
      if(!record(profile.stage,profile.identityFields,{...point,...Object.fromEntries(profile.identityFields.map(key=>[key,business[key]]))}))return blocked('ambiguous','Frame 간 업무 식별 또는 화면 값이 충돌합니다.');
      // Repeated item identities with differing values are also ambiguous.
      const itemKeys=profile.stage==='receipt'?['ctrtDmndRcptItemSqno']:profile.stage==='bid'?['bidClsfNo','bidPbancItemSqno']:['ctrtItemSqno'];
      for(const row of rows.filter(row=>complete(row,itemKeys))){const key=profile.stage+'_item:'+identity(row,itemKeys),old=records.get(key);if(old&&conflicts(old,row))return blocked('ambiguous','동일 물품의 Dataset 값이 충돌합니다.');records.set(key,{...old,...Object.fromEntries(Object.entries(row).filter(([,value])=>present(value)))});}
      selected.push(unit);
    }else{
      const tables:CapturePayload['tables']=Object.create(null);let matches=false;
      for(const rule of policy.rules){
        if(rule.enabled===false||!screenMatches(point,rule))continue;
        if(rule.urlFilter&&!('join' in rule.urlFilter?matchesFilter({url:unit.url},rule.urlFilter):matchesCondition({url:unit.url},rule.urlFilter)))continue;
        const sourceRows=rule.dataset==='$pointInfo'?[point]:unit.tables[datasetName(unit,rule.dataset)??'']??[];
        if(!sourceRows.length)continue;
        recognized=true;
        const eligible=sourceRows.filter(row=>complete(row,rule.identityFields));
        for(const row of eligible){if(!record(rule.sourceId,rule.identityFields,row,false))return blocked('ambiguous','설정된 규칙의 동일 업무 값이 충돌합니다.');}
        const profile=approvedScreenProfiles.find(profile=>rule.sourceId==='procurement.'+profile.stage||rule.sourceId==='procurement.'+profile.stage+'_item');
        if(profile&&eligible.length){
          const parents=[point,...eligible].filter(row=>complete(row,profile.identityFields));
          for(const parent of parents){
            const context=profile.stage+':'+identity(parent,profile.identityFields);
            if(customProcurementContext!==undefined&&customProcurementContext!==context)return blocked('ambiguous','수집 규칙이 서로 다른 업무 문맥을 포함합니다.');
            customProcurementContext=context;
          }
          if(parents.length&&[point,...sourceRows].some(row=>profile.identityFields.some(key=>present(row[key])&&String(row[key])!==String(parents[0][key]))))return blocked('ambiguous','설정된 Dataset의 일부 업무 식별값이 충돌합니다.');
        }
        if(eligible.length){
          matches=true;
          if(rule.dataset!=='$pointInfo') {
            const dataset=datasetName(unit,rule.dataset)!;
            const accepted=new Set([...(tables[dataset]??[]),...eligible].map(stable));
            // Multiple rules form an OR over the original dataset; retain its order and multiplicity.
            tables[dataset]=sourceRows.filter(row=>accepted.has(stable(row)));
          }
        }
      }
      if(matches)selected.push({...unit,tables,...(unit.tableSources?{tableSources:Object.fromEntries(Object.entries(unit.tableSources).filter(([name])=>Object.hasOwn(tables,name)))}:{})});
    }
  }
  if(!selected.length)return blocked(recognized?'identity_missing':'unconfigured',recognized?'지정 화면의 업무 식별 열이 완전하지 않아 수집하지 않았습니다.':rejectedDefaultUrl?'기본 수집은 HTTP/HTTPS의 g2b.go.kr 또는 하위 도메인에서만 허용됩니다. 다른 사이트는 URL·화면 규칙을 등록하세요.':'지정된 수집 화면/규칙과 일치하지 않아 수집하지 않았습니다.');
  return {allowed:true,status:'allowed',reason:'지정 화면과 업무 식별을 확인했습니다.',filteredPayload:compose(selected,payload)};
}
