import Decimal from 'decimal.js';
const Exact = Decimal.clone({precision:50,rounding:Decimal.ROUND_HALF_UP});
// A deliberately small grammar. No JavaScript evaluation or persistent formulas.
// Decimal text is returned so a Grid save never passes through IEEE-754 Number.
export function evaluateCalculation(expression:string,row:Record<string,unknown>={}):string {
  const expanded=expression.replace(/\[([^\]]+)\]/g,(_,field:string)=>{
    const value=row[field];if(value==null||value===''||!/^[-+]?\d+(\.\d+)?$/.test(String(value)))throw new Error(`숫자가 아닌 열: ${field}`);return `(${String(value)})`;
  });
  const tokens=expanded.match(/\d+(?:\.\d+)?|[()+\-*/]/g)??[];
  if(tokens.join('')!==expanded.replace(/\s/g,''))throw new Error('사칙연산과 [열 이름]만 사용할 수 있습니다.');
  let offset=0;
  const atom=():Decimal=>{
    const token=tokens[offset++];
    if(token==='+'||token==='-')return atom().times(token==='-'?-1:1);
    if(token==='('){const value=sum();if(tokens[offset++]!==')')throw new Error('괄호를 확인하세요.');return value;}
    if(!token||!/^\d/.test(token))throw new Error('수식을 확인하세요.');return new Exact(token);
  };
  const product=():Decimal=>{let value=atom();while(tokens[offset]==='*'||tokens[offset]==='/'){const op=tokens[offset++],right=atom();if(op==='/'&&right.isZero())throw new Error('0으로 나눌 수 없습니다.');value=op==='*'?value.times(right):value.div(right);}return value;};
  const sum=():Decimal=>{let value=product();while(tokens[offset]==='+'||tokens[offset]==='-'){const op=tokens[offset++],right=product();value=op==='+'?value.plus(right):value.minus(right);}return value;};
  const answer=sum();if(offset!==tokens.length||!answer.isFinite())throw new Error('올바른 유한 수식이 아닙니다.');return answer.toFixed();
}
export function aggregateDecimal(values:unknown[],operation:'sum'|'average'):string {
  const numbers=values.filter(v=>v!=null&&v!=='').map(v=>new Exact(String(v)));
  if(numbers.some(v=>!v.isFinite()))throw new Error('숫자만 집계할 수 있습니다.');
  if(!numbers.length)return operation==='sum'?'0':'';
  const total=numbers.reduce((sum,n)=>sum.plus(n),new Exact(0));
  return (operation==='sum'?total:total.div(numbers.length)).toFixed();
}
export function shiftDate(iso:string,days:number):string {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(iso)||!Number.isInteger(days))throw new Error('날짜와 정수 일수를 입력하세요.');
  const date=new Date(`${iso}T00:00:00Z`);if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==iso)throw new Error('존재하지 않는 날짜입니다.');
  date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);
}
