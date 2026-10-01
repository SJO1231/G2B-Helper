import type { FilterGroup } from '../../packages/contracts/src/index';
import { evaluateCalculation, getPath, matchesFilter, shiftDate, validateFilter } from '../core/index';

export interface TemplateClause { id: string; label: string; condition: FilterGroup; whenTrue: string; whenFalse: string; }
export interface TemplateProgram { version: 1; missingMode: 'mark' | 'empty' | 'error'; clauses: TemplateClause[]; }
export interface TemplateResult { text: string; warnings: string[]; usedFields: string[]; }
export const defaultTemplateProgram = (): TemplateProgram => ({ version: 1, missingMode: 'mark', clauses: [] });
/** Literal JSON keys (including dots/braces) must not become a different nested path. */
export function templatePathToken(path:string[]):string {
  return '{{path:'+encodeURIComponent(JSON.stringify(path))+'}}';
}
export function validateTemplateProgram(program: TemplateProgram): void {
  if (!program || program.version !== 1 || !['mark', 'empty', 'error'].includes(program.missingMode) || !Array.isArray(program.clauses) || program.clauses.length > 100) throw new Error('템플릿 조건 설정 형식을 확인하세요.');
  const ids = new Set<string>();
  for (const clause of program.clauses) {
    if (!clause || typeof clause.id !== 'string' || !/^[\w가-힣-]+$/.test(clause.id) || ids.has(clause.id) || typeof clause.label !== 'string' || typeof clause.whenTrue !== 'string' || typeof clause.whenFalse !== 'string') throw new Error('조건 이름·식별자·출력 문구를 확인하세요.');
    if(clause.whenTrue.length>4*1024*1024||clause.whenFalse.length>4*1024*1024)throw new Error('조건 문구는 4MB 이하로 사용하세요.');
    ids.add(clause.id); validateFilter(clause.condition);
  }
}

/** A bounded template interpreter. Text from DB never becomes executable code. */
export function renderTemplate(body: string, values: Record<string, unknown>, program = defaultTemplateProgram(), today = new Date()): TemplateResult {
  validateTemplateProgram(program);
  if (body.length > 4 * 1024 * 1024) throw new Error('텍스트 템플릿은 4MB 이하로 사용하세요.');
  const used = new Set<string>(), warnings = new Set<string>();
  const valueAt = (field: string): unknown => {
    if (['__proto__', 'constructor', 'prototype'].includes(field)) return undefined;
    used.add(field);
    if(field.startsWith('path:')){let path:unknown;try{path=JSON.parse(decodeURIComponent(field.slice(5)));}catch{throw new Error('템플릿 JSON 경로 토큰을 확인하세요.');}if(!Array.isArray(path)||path.length>30||path.some(segment=>typeof segment!=='string'))throw new Error('템플릿 JSON 경로 토큰을 확인하세요.');return getPath(values,path);}
    return Object.hasOwn(values, field) ? values[field] : getPath(values, field.split('.'));
  };
  const string = (value: unknown) => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  const missing = (field: string) => {
    warnings.add(`누락 필드: ${field}`);
    if (program.missingMode === 'error') throw new Error(`템플릿에 필요한 열이 없습니다: ${field}`);
    return program.missingMode === 'empty' ? '' : `[누락: ${field}]`;
  };
  const fieldText = (field: string) => { const value = valueAt(field); return value === undefined ? missing(field) : string(value); };
  type Branch = { tag: string; field: string; expected: string; children: (string | Branch)[] };
  const root: Branch = { tag: '', field: '', expected: '', children: [] }, stack: Branch[] = [root];
  const tags = /\[(\/?)(같음|다름)(?::([^:\]]+):([^\]]*))?\]/g; let offset = 0, count = 0;
  for (const match of body.matchAll(tags)) {
    if (++count > 400) throw new Error('조건 태그가 너무 많습니다.');
    stack.at(-1)!.children.push(body.slice(offset, match.index)); offset = match.index! + match[0].length;
    if (match[1]) { if (stack.length < 2 || stack.at(-1)!.tag !== match[2]) throw new Error('같음/다름 조건의 닫기 태그가 맞지 않습니다.'); stack.pop(); }
    else { if (!match[3] || stack.length > 12) throw new Error('조건 필드 또는 중첩 깊이를 확인하세요.'); const branch: Branch = { tag: match[2], field: match[3].trim(), expected: match[4] ?? '', children: [] }; stack.at(-1)!.children.push(branch); stack.push(branch); }
  }
  stack.at(-1)!.children.push(body.slice(offset)); if (stack.length !== 1) throw new Error('닫지 않은 같음/다름 조건 태그가 있습니다.');
  const evaluate = (branch: Branch): string => {
    if (branch.tag) { const value = valueAt(branch.field), equal = string(value) === branch.expected; if (value === undefined) warnings.add(`조건 필드 누락: ${branch.field}`); if ((branch.tag === '같음') !== equal) return ''; }
    return branch.children.map(child => typeof child === 'string' ? child : evaluate(child)).join('');
  };
  const clauseStack = new Set<string>();let substitutions=0;
  function substitute(text: string, depth = 0): string {
    if (depth > 12) throw new Error('템플릿 조건 참조가 너무 깊습니다.');
    const result=text.replace(/\{\{\s*([^{}]+?)\s*\}\}|\{([^{}]+)\}/g, (_match, double: string | undefined, single: string | undefined) => {
      if(++substitutions>10000)throw new Error('한 번에 치환하는 값이 너무 많습니다.');
      const expression = (double ?? single ?? '').trim();
      if (expression.startsWith('@')) {
        const id = expression.slice(1), clause = program.clauses.find(candidate => candidate.id === id);
        if (!clause) return missing('조건 ' + id);
        if (clauseStack.has(id)) throw new Error('템플릿 조건이 순환 참조합니다.');
        clauseStack.add(id); const selected = matchesFilter(values, clause.condition) ? clause.whenTrue : clause.whenFalse;
        const result = substitute(selected, depth + 1); clauseStack.delete(id); return result;
      }
      if (Object.hasOwn(values, expression)) return fieldText(expression);
      if(expression.startsWith('path:'))return fieldText(expression);
      const date = /^오늘([+-]?\d+)?$/.exec(expression);
      if (date) { const base = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`; return shiftDate(base, Number(date[1] ?? 0)).replaceAll('-', '/'); }
      const replace = /^([^:]+):대체:([^:]*):(.*)$/.exec(expression); if (replace) return fieldText(replace[1].trim()).replaceAll(replace[2], replace[3]);
      const slice = /^([^:]+):(-?\d+)(?::(\d+))?$/.exec(expression);
      if (slice) { const value = [...fieldText(slice[1].trim())]; return slice[3] === undefined ? value.slice(0, Number(slice[2])).join('') : value.slice(Math.max(0, Number(slice[2]) - 1), Number(slice[3])).join(''); }
      if (expression.startsWith('=') || /[+*/]/.test(expression) || (/[-]/.test(expression) && Object.keys(values).some(field => field && expression.includes(field)))) {
        const source = expression.replace(/^=/, ''), fields = Object.keys(values).filter(field => field && !field.startsWith('__')).sort((a,b)=>b.length-a.length);
        let formula = '', cursor = 0;
        while (cursor < source.length) {
          if (/\s/.test(source[cursor])) { cursor++; continue; }
          if (source[cursor] === '[') {
            const end = source.indexOf(']', cursor + 1); if (end < 0) throw new Error('계산 열의 대괄호를 확인하세요.');
            const field = source.slice(cursor + 1, end); valueAt(field); formula += `[${field}]`; cursor = end + 1; continue;
          }
          const field = fields.find(candidate => source.startsWith(candidate, cursor));
          if (field) { valueAt(field); formula += `[${field}]`; cursor += field.length; continue; }
          const number = /^\d+(?:\.\d+)?/.exec(source.slice(cursor));
          if (number) { formula += number[0]; cursor += number[0].length; continue; }
          if ('()+-*/'.includes(source[cursor])) { formula += source[cursor++]; continue; }
          throw new Error('계산식은 사칙연산·숫자·DB 열만 사용할 수 있습니다.');
        }
        const operands=Object.fromEntries([...formula.matchAll(/\[([^\]]+)\]/g)].map(match=>[match[1],valueAt(match[1])]));
        return evaluateCalculation(formula, operands);
      }
      return fieldText(expression);
    });if(result.length>4*1024*1024)throw new Error('생성한 텍스트가 4MB를 넘습니다.');return result;
  }
  const text = substitute(evaluate(root)); if (text.length > 4 * 1024 * 1024) throw new Error('생성한 텍스트가 4MB를 넘습니다.');
  return { text, warnings: [...warnings], usedFields: [...used] };
}
