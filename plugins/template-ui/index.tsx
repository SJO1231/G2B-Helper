import { FilterEditor } from '../filter-ui/index';
import type { Column } from '../grid/index';
import type { TemplateProgram } from '../template/index';
import type { FilterGroup } from '../../packages/contracts/src/index';

export function TemplateProgramEditor({program,onChange,columns,onInsert}:{program:TemplateProgram;onChange:(value:TemplateProgram)=>void;columns:Column[];onInsert?:(token:string)=>void}) {
  const update=(index:number,changes:Partial<TemplateProgram['clauses'][number]>)=>onChange({...program,clauses:program.clauses.map((clause,position)=>position===index?{...clause,...changes}:clause)});
  return <details className="template-conditions"><summary>조건에 따른 출력 · {program.clauses.length}개</summary>
    <div className="row"><label>누락 필드 <select aria-label="템플릿 누락 처리" value={program.missingMode} onChange={event=>onChange({...program,missingMode:event.target.value as TemplateProgram['missingMode']})}><option value="mark">누락 표시</option><option value="empty">빈 문자열</option><option value="error">생성 중단</option></select></label>
      <button onClick={()=>{const id='조건_'+crypto.randomUUID().slice(0,8);onChange({...program,clauses:[...program.clauses,{id,label:'새 출력 조건',condition:{join:'and',conditions:[]},whenTrue:'',whenFalse:''}]});}}>+ 출력 조건</button></div>
    {program.clauses.map((clause,index)=><section className="condition-card" key={clause.id}>
      <div className="row"><input aria-label="출력 조건 이름" value={clause.label} onChange={event=>update(index,{label:event.target.value})}/><code>{'{{@'+clause.id+'}}'}</code>{onInsert&&<button onClick={()=>onInsert('{{@'+clause.id+'}}')}>본문에 삽입</button>}<button onClick={()=>onChange({...program,clauses:program.clauses.filter((_,position)=>position!==index)})}>조건 삭제</button></div>
      <FilterEditor value={clause.condition} columns={columns} onChange={condition=>update(index,{condition:condition as FilterGroup})}/>
      <div className="two-pane"><label>조건 충족 시<textarea aria-label="조건 충족 출력" value={clause.whenTrue} onChange={event=>update(index,{whenTrue:event.target.value})}/></label><label>조건 불충족 시<textarea aria-label="조건 불충족 출력" value={clause.whenFalse} onChange={event=>update(index,{whenFalse:event.target.value})}/></label></div>
    </section>)}
  </details>;
}
