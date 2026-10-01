export interface PageAction { kind:'click'|'setValue'|'dateShift'|'readText'; selector:string; value?:string; days?:number; }
export type WorkActionRole = 'startDate'|'endDate'|'rowCount'|'search'|'excel';
export interface WorkActionRequest {
  kind: 'detect'|'yearShift'|'yearRange'|'setRowCount'|'search'|'excel';
  mode?: 'inspect'|'apply';
  years?: number;
  year?: number;
  rowCount?: number;
  searchAfter?: boolean;
  /** Chrome injects into each frame separately; bookmarklets may opt into readable children. */
  traverseFrames?: boolean;
  selectors?: Partial<Record<WorkActionRole,string>>;
  selection?: Partial<Record<WorkActionRole,string>>;
}
export interface WorkActionCandidate {
  id:string; role:WorkActionRole; framePath:string; elementId:string; componentId:string;
  label:string; value:string; via:'websquare'|'dom'; evidence:string;
  disabled:boolean; ready:boolean; reason?:string; options?:string[];
}
export interface WorkActionResult {
  status:'ready'|'applied'|'needsSelection'|'unavailable'|'invalid'|'failed';
  candidates:WorkActionCandidate[];
  selected:Partial<Record<WorkActionRole,WorkActionCandidate>>;
  changes:{role:WorkActionRole; candidateId:string; before:string; after:string}[];
  clicked:boolean; warnings:string[]; message:string;
}

/** Self-contained: Chrome scripting.executeScript serializes this function without its module. */
export function performWorkAction(request:WorkActionRequest):WorkActionResult {
  const candidates:WorkActionCandidate[]=[];
  const selected:WorkActionResult['selected']={};
  const changes:WorkActionResult['changes']=[];
  const warnings:string[]=[];
  let clicked=false;
  const result=(status:WorkActionResult['status'],message:string):WorkActionResult=>({status,candidates,selected,changes,clicked,warnings,message});
  if(!request || !['detect','yearShift','yearRange','setRowCount','search','excel'].includes(request.kind)) return result('invalid','업무 동작 종류를 확인하세요.');
  if(request.mode!==undefined && !['inspect','apply'].includes(request.mode)) return result('invalid','업무 동작 모드를 확인하세요.');
  const roles:WorkActionRole[]=['startDate','endDate','rowCount','search','excel'];
  const targets=new Map<string,{element:HTMLElement; w:Window; component:any}>();
  const text=(value:unknown)=>String(value??'').trim().replace(/\s+/g,' ');
  const windows:{w:Window; path:string}[]=[];
  const visited=new Set<Window>();
  function walk(w:Window,path:string,depth:number) {
    if(visited.has(w) || depth>12) return;
    visited.add(w);
    try {
      if(!w.document) return;
      windows.push({w,path});
      if(request.traverseFrames) for(let i=0;i<w.frames.length;i++) walk(w.frames[i],path+'/frames['+i+']',depth+1);
    } catch(error) { warnings.push(path+': frame 접근 불가 ('+String(error)+')'); }
  }
  walk(window,'top',0);
  function component(w:Window,element:HTMLElement) {
    const id=element.id;
    if(!id) return null;
    for(const getter of [(w as any).$p,(w as any).WebSquare?.util]) {
      if(typeof getter?.getComponentById!=='function') continue;
      try { const found=getter.getComponentById(id); if(found) return found; }
      catch(error) { warnings.push(id+': WebSquare component 확인 실패 ('+String(error)+')'); }
    }
    return null;
  }
  function visible(element:HTMLElement,w:Window) {
    if(element.hidden || element.closest('[hidden],[aria-hidden="true"],#pce-bookmarklet-root,[data-pce-root]')) return false;
    const style=w.getComputedStyle(element),rect=element.getBoundingClientRect();
    return style.display!=='none' && style.visibility!=='hidden' && style.opacity!=='0' && rect.width>0 && rect.height>0;
  }
  function read(element:HTMLElement,c:any) {
    if(typeof c?.getValue==='function') return String(c.getValue()??'');
    return String((element as HTMLInputElement).value??'');
  }
  function nativeSetter(element:HTMLElement,w:Window) {
    const world=w as any;
    const proto=element.tagName==='SELECT' ? world.HTMLSelectElement?.prototype : element.tagName==='TEXTAREA' ? world.HTMLTextAreaElement?.prototype : element.tagName==='INPUT' ? world.HTMLInputElement?.prototype : undefined;
    return proto && Object.getOwnPropertyDescriptor(proto,'value')?.set;
  }
  for(const {w,path} of windows) {
    const d=w.document;
    for(const role of roles) {
      let elements:HTMLElement[]=[];
      const manual=request.selectors?.[role];
      try {
        if(manual!==undefined) {
          if(!manual.trim()) return result('invalid',role+' 선택자가 비어 있습니다.');
          elements=Array.from(d.querySelectorAll<HTMLElement>(manual));
        } else if(role==='startDate' || role==='endDate') {
          elements=Array.from(d.querySelectorAll<HTMLElement>(role==='startDate' ? "input[id$='_ibxStrDay']" : "input[id$='_ibxEndDay']"));
        } else if(role==='rowCount') {
          elements=Array.from(d.querySelectorAll<HTMLElement>('select')).filter(e=>/recordcountperpage|recordcount|pagesize/i.test(e.id));
        } else {
          const selector=role==='search' ? '#mf_wfm_container_btnS0001,input.w2trigger.btn_cm.srch[value="검색"],input[value="조회"],input[value="검색"]' : '#mf_wfm_container_btnExcelDwnld,.excel_down,input[value="엑셀다운로드"],input[value="엑셀다운"]';
          const names=role==='search' ? ['조회','검색'] : ['엑셀다운로드','엑셀다운','엑셀저장','Excel'];
          elements=Array.from(d.querySelectorAll<HTMLElement>(selector));
          for(const e of d.querySelectorAll<HTMLElement>('button,a,input[type="button"],input[type="submit"],[role="button"],.w2trigger,.w2trigger_anchor')) {
            const label=text((e as HTMLInputElement).value || e.textContent || e.getAttribute('aria-label') || e.getAttribute('title'));
            if(names.includes(label)) elements.push(e);
          }
        }
        elements=[...new Set(elements)].filter(e=>visible(e,w));
      } catch(error) { return result('invalid',role+' 선택자/화면 확인 실패: '+String(error)); }
      for(let i=0;i<elements.length;i++) {
        const element=elements[i],c=component(w,element);
        const id=path+':'+role+':'+encodeURIComponent(element.id || element.tagName+':'+i+':'+text(element.textContent));
        const disabled=!!(element as HTMLInputElement).disabled || element.getAttribute('aria-disabled')==='true' || !!element.closest('fieldset[disabled]');
        const valueRole=role==='startDate' || role==='endDate' || role==='rowCount';
        let value='',reason:string|undefined;
        try { value=read(element,c); } catch(error) { reason='값 확인 실패: '+String(error); }
        if(disabled) reason='비활성화된 요소입니다.';
        else if(valueRole && (element as HTMLInputElement).readOnly && typeof c?.setValue!=='function') reason='읽기 전용 요소입니다.';
        else if(valueRole && typeof c?.setValue!=='function' && !nativeSetter(element,w)) reason='값 적용 API가 없습니다.';
        else if(!valueRole && typeof c?.trigger!=='function' && typeof c?.fireEvent!=='function' && typeof element.click!=='function') reason='클릭 API가 없습니다.';
        const item:WorkActionCandidate={id,role,framePath:path,elementId:element.id,componentId:element.id,label:text(element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || (element as HTMLInputElement).value || element.id),value,via:c?'websquare':'dom',evidence:manual!==undefined?'사용자 선택자':role==='rowCount'?'참고 코드의 건수 ID':role==='startDate'||role==='endDate'?'참고 코드의 날짜 ID suffix':'참고 코드의 버튼 선택자 또는 정확한 버튼 문구',disabled,ready:!reason,...(reason?{reason}:{})};
        if(role==='rowCount' && element.tagName==='SELECT') item.options=Array.from((element as HTMLSelectElement).options).filter(o=>!o.disabled).map(o=>o.value);
        candidates.push(item); targets.set(id,{element,w,component:c});
      }
    }
  }
  if(request.kind==='detect') return result(candidates.length?'ready':'unavailable',candidates.length?'현재 frame의 업무 동작 후보를 확인했습니다.':'현재 frame에서 근거가 있는 업무 요소를 찾지 못했습니다.');
  const required:WorkActionRole[]=request.kind==='yearShift'||request.kind==='yearRange' ? ['startDate','endDate'] : [request.kind==='setRowCount'?'rowCount':request.kind];
  if(request.searchAfter && !required.includes('search')) required.push('search');
  let missing=false,ambiguous=false;
  for(const role of required) {
    const matches=candidates.filter(c=>c.role===role);
    const chosenId=request.selection?.[role];
    if(chosenId!==undefined) {
      const chosen=matches.find(c=>c.id===chosenId);
      if(!chosen) return result('invalid',role+' 선택 대상이 현재 frame에 없습니다. 다시 감지하세요.');
      selected[role]=chosen;
    } else if(matches.length===1) selected[role]=matches[0];
    else if(matches.length===0) missing=true;
    else ambiguous=true;
  }
  if(ambiguous) return result('needsSelection','업무 요소 후보가 여러 개입니다. frame과 요소를 선택하세요.');
  if(missing) return result('unavailable','필요한 업무 요소를 찾지 못했습니다. 화면 또는 선택자를 확인하세요.');
  for(const role of required) if(!selected[role]?.ready) return result('unavailable',selected[role]?.reason || '적용할 수 없는 요소입니다.');
  if(new Set(required.map(role=>selected[role]!.framePath)).size>1) return result('needsSelection','날짜·건수·조회는 같은 frame의 요소를 선택하세요.');
  if(selected.startDate && selected.endDate && !request.selectors?.startDate && !request.selectors?.endDate && !(request.selection?.startDate && request.selection?.endDate)) {
    const startPrefix=selected.startDate.elementId.replace(/_ibxStrDay$/,''),endPrefix=selected.endDate.elementId.replace(/_ibxEndDay$/,'');
    if(startPrefix!==endPrefix) return result('needsSelection','날짜 요소의 화면 그룹이 다릅니다. 시작·종료 요소를 직접 선택하세요.');
  }
  function parseDate(raw:string) {
    const match=/^(\d{4})(-?)(\d{2})\2(\d{2})$/.exec(raw);
    if(!match) throw new Error('날짜 형식은 YYYY-MM-DD 또는 YYYYMMDD여야 합니다.');
    const year=Number(match[1]),month=Number(match[3]),day=Number(match[4]);
    const date=new Date(0); date.setUTCFullYear(year,month-1,day); date.setUTCHours(12,0,0,0);
    if(year<1 || date.getUTCFullYear()!==year || date.getUTCMonth()!==month-1 || date.getUTCDate()!==day) throw new Error('유효하지 않은 날짜입니다.');
    return {year,month,day,separator:match[2]};
  }
  function formatDate(year:number,month:number,day:number,separator:string) {
    if(year<1 || year>9999) throw new Error('날짜 연도는 1~9999여야 합니다.');
    return String(year).padStart(4,'0')+separator+String(month).padStart(2,'0')+separator+String(day).padStart(2,'0');
  }
  try {
    if(request.kind==='yearShift' || request.kind==='yearRange') {
      if(request.kind==='yearShift' && (!Number.isInteger(request.years) || Math.abs(request.years!)>100 || request.years===0)) return result('invalid','이동 연수는 0을 제외한 -100~100 정수여야 합니다.');
      if(request.kind==='yearRange' && (!Number.isInteger(request.year) || request.year!<1 || request.year!>9999)) return result('invalid','1년 기간의 기준 연도를 확인하세요.');
      for(const role of ['startDate','endDate'] as const) {
        const item=selected[role]!,parts=parseDate(item.value);
        let after:string;
        if(request.kind==='yearRange') after=formatDate(request.year!,role==='startDate'?1:12,role==='startDate'?1:31,parts.separator);
        else {
          const start=parseDate(selected.startDate!.value),end=parseDate(selected.endDate!.value);
          const annual=start.month===1 && start.day===1 && end.month===12 && end.day===31;
          const year=annual?parts.year+request.years!:start.year;
          after=formatDate(year,role==='startDate'?1:12,role==='startDate'?1:31,parts.separator);
        }
        changes.push({role,candidateId:item.id,before:item.value,after});
      }
      if(changes[0].after.replaceAll('-','')>changes[1].after.replaceAll('-','')) return result('invalid','시작 날짜가 종료 날짜보다 늦습니다.');
    } else if(request.kind==='setRowCount') {
      if(!Number.isSafeInteger(request.rowCount) || request.rowCount!<1) return result('invalid','조회 건수는 양의 안전한 정수여야 합니다.');
      const item=selected.rowCount!,after=String(request.rowCount);
      if(item.options && !item.options.includes(after)) warnings.push('화면에 조회 건수 항목을 추가합니다. 서버의 지원 및 조회 결과는 별도 확인해야 합니다.');
      changes.push({role:'rowCount',candidateId:item.id,before:item.value,after});
    }
  } catch(error) { return result('invalid',String(error)); }
  if(request.mode==='inspect') return result('ready',changes.length?'값을 적용할 수 있습니다. 아직 변경하거나 클릭하지 않았습니다.':'조회/다운로드 버튼을 실행할 수 있습니다. 아직 클릭하지 않았습니다.');
  function write(id:string,value:string) {
    const target=targets.get(id)!;
    if(typeof target.component?.setValue==='function') target.component.setValue(value);
    else {
      nativeSetter(target.element,target.w)!.call(target.element,value);
      const EventCtor=(target.w as any).Event;
      target.element.dispatchEvent(new EventCtor('input',{bubbles:true}));
      target.element.dispatchEvent(new EventCtor('change',{bubbles:true}));
    }
    if(read(target.element,target.component)!==value) throw new Error('값 적용 후 읽기 결과가 일치하지 않습니다: '+target.element.id);
  }
  const attempted:typeof changes=[];
  const addedOptions:HTMLOptionElement[]=[];
  const componentItems:string[]=[];
  try {
    for(const change of changes) {
      attempted.push(change);
      if(change.role==='rowCount' && !selected.rowCount!.options?.includes(change.after)) {
        const target=targets.get(change.candidateId)!;
        if(target.element.tagName==='SELECT') {
          if(typeof target.component?.addItem==='function') {
            componentItems.push(change.after);
            target.component.addItem(change.after,change.after);
          }
          if(!Array.from((target.element as HTMLSelectElement).options).some(o=>o.value===change.after)) {
            const option=target.element.ownerDocument.createElement('option');
            option.value=change.after; option.text=change.after+'건'; target.element.appendChild(option);
            addedOptions.push(option);
          }
        }
      }
      write(change.candidateId,change.after);
    }
    const clickRole:WorkActionRole|undefined=request.kind==='search'?'search':request.kind==='excel'?'excel':request.searchAfter?'search':undefined;
    if(clickRole) {
      const target=targets.get(selected[clickRole]!.id)!;
      clicked=true;
      if(typeof target.component?.trigger==='function') target.component.trigger('onclick');
      else if(typeof target.component?.fireEvent==='function') target.component.fireEvent('onclick');
      else target.element.click();
    }
    return result('applied',clicked?'요청한 버튼 동작을 실행했습니다. 응답/다운로드 완료는 별도 확인이 필요합니다.':'값을 적용했습니다. 조회 버튼은 누르지 않았습니다.');
  } catch(error) {
    for(const change of [...attempted].reverse()) try { write(change.candidateId,change.before); } catch(rollbackError) { warnings.push('원값 복원 실패: '+String(rollbackError)); }
    for(const added of addedOptions) try { added.remove(); } catch(rollbackError) { warnings.push('건수 옵션 복원 실패: '+String(rollbackError)); }
    if(componentItems.length) warnings.push('WebSquare에 추가를 요청한 건수 항목은 유지될 수 있습니다: '+componentItems.join(', '));
    if(clicked) warnings.push('버튼 실행을 시도했습니다. 이미 발생한 조회/다운로드 요청은 복원할 수 없습니다.');
    return result('failed','업무 동작 실패: '+String(error));
  }
}

export function performPageAction(action: PageAction) {
  const elements = document.querySelectorAll(action.selector);
  if(elements.length !== 1) throw new Error('설정한 선택자가 정확히 한 요소를 가리켜야 합니다. 발견: ' + elements.length);
  const element = elements[0] as HTMLInputElement;
  if(action.kind === 'readText') return {text: typeof element.value === 'string' ? element.value : (element.textContent ?? '').trim()};
  if(action.kind === 'click') { element.click(); return {applied:true}; }
  let value = action.value ?? '';
  if(action.kind === 'dateShift') {
    if(!Number.isInteger(action.days) || Math.abs(action.days!) > 3660) throw new Error('날짜 이동 일수를 확인하세요.');
    const compact = /^\d{8}$/.test(element.value);
    const raw = compact ? element.value.slice(0,4)+'-'+element.value.slice(4,6)+'-'+element.value.slice(6,8) : element.value;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error('날짜 형식은 YYYY-MM-DD 또는 YYYYMMDD여야 합니다.');
    const date = new Date(raw + 'T12:00:00Z'); if(!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==raw) throw new Error('유효하지 않은 날짜입니다.');
    date.setUTCDate(date.getUTCDate()+action.days!); value=date.toISOString().slice(0,10); if(compact)value=value.replaceAll('-','');
  }
  const component = (window as any).WebSquare?.util?.getComponentById(element.id);
  if(typeof component?.setValue === 'function') component.setValue(value);
  else {
    const proto=element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set; if(!setter)throw new Error('값을 바꿀 수 없는 요소입니다.');
    setter.call(element,value);
    element.dispatchEvent(new Event('input',{bubbles:true})); element.dispatchEvent(new Event('change',{bubbles:true}));
  }
  return {applied:true,value};
}
