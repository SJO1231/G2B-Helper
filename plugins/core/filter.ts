import type { FilterCondition, FilterGroup } from '../../packages/contracts/src/index';
import {getPath,isBlank} from './json';

export function compareDecimal(left:string,right:string):number|null {
  const parse = (value:string):[bigint,number]|null=>{
    const match=/^([+-]?)(\d+)(?:\.(\d*))?$/.exec(value.trim());
    if(!match) return null;
    return [BigInt(`${match[1]==='-'?'-':''}${match[2]}${match[3]??''}`),(match[3]??'').length];
  };
  const a=parse(left),b=parse(right); if(!a||!b)return null;
  const scale=Math.max(a[1],b[1]);
  const x=a[0]*10n**BigInt(scale-a[1]),y=b[0]*10n**BigInt(scale-b[1]);
  return x<y?-1:x>y?1:0;
}
export function validateFilter(group:FilterGroup,depth=0):void {
  if(depth>12||!group||!['and','or'].includes(group.join)||!Array.isArray(group.conditions)||group.conditions.length>100)throw new Error('필터 그룹 형식 또는 크기가 잘못되었습니다.');
  for(const entry of group.conditions){
    if('join' in entry)validateFilter(entry,depth+1);
    else if(typeof entry.field!=='string'||!['equals','notEquals','contains','notContains','gt','gte','lt','lte','empty','notEmpty'].includes(entry.operator)||!Array.isArray(entry.values)||entry.values.some(x=>typeof x!=='string')||entry.values.length>1000||(!['empty','notEmpty'].includes(entry.operator)&&!entry.values.length)||(entry.path!==undefined&&(!Array.isArray(entry.path)||entry.path.some(x=>typeof x!=='string'))))throw new Error('필터 조건 또는 검색값이 잘못되었습니다.');
  }
}
export function matchesCondition(row:Record<string,unknown>,condition:FilterCondition,dictionaries:Record<string,Record<string,string>>={}):boolean {
  let actual=getPath(row[condition.field],condition.path??[]);
  if(condition.operator==='empty')return isBlank(actual);
  if(condition.operator==='notEmpty')return !isBlank(actual);
  if(isBlank(actual))return condition.includeEmpty===true;
  if(condition.compareAs==='label') actual=dictionaries[condition.field]?.[String(actual)]??actual;
  const text=typeof actual==='object'?JSON.stringify(actual):String(actual);
  const values=condition.values;
  if(!values.length)return true;
  switch(condition.operator){
    case 'equals':return values.some(value=>text===value);
    case 'notEquals':return values.every(value=>text!==value);
    case 'contains':return values.some(value=>text.includes(value));
    case 'notContains':return values.every(value=>!text.includes(value));
    default:return values.some(value=>{
      const compared=compareDecimal(text,value)??(text<value?-1:text>value?1:0);
      return condition.operator==='gt'?compared>0:condition.operator==='gte'?compared>=0:condition.operator==='lt'?compared<0:compared<=0;
    });
  }
}
export function matchesFilter(row:Record<string,unknown>,group?:FilterGroup,dictionaries:Record<string,Record<string,string>>={}):boolean {
  if(!group)return true; validateFilter(group);
  const evaluate=(g:FilterGroup):boolean=>!g.conditions.length|| (g.join==='and'?g.conditions.every(test):g.conditions.some(test));
  const test=(entry:FilterCondition|FilterGroup):boolean=>'join' in entry?evaluate(entry):matchesCondition(row,entry,dictionaries);
  return evaluate(group);
}
