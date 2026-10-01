import type {ColumnDefinition,TableRow} from '../../../packages/contracts/src/index';
export type NoteKind='memos'|'schedules';
export type NoteMode='all'|'memos'|'manager'|'schedules'|'calendar';
export type NoteContext={screenKey?:string;url?:string;requiresScreenSelection?:boolean;pointInfo?:Record<string,unknown>};
export type NoteDraft={title:string;body:string;screenKey:string;start:string;end:string;important:boolean;urgent:boolean;completed:boolean;color?:string;trashed?:boolean};
export const noteColors=[{key:'yellow',name:'노랑'},{key:'green',name:'연두'},{key:'blue',name:'하늘'},{key:'pink',name:'분홍'},{key:'plain',name:'기본'}] as const;
export const noteColumns:ColumnDefinition[]=[{field:'body',label:'내용',kind:'text',editable:true},{field:'important',label:'중요',kind:'boolean',editable:true},{field:'urgent',label:'긴급',kind:'boolean',editable:true},{field:'completed',label:'완료',kind:'boolean',editable:true},{field:'color',label:'색상',kind:'text',editable:true},{field:'trashed',label:'휴지통',kind:'boolean',editable:true},{field:'createdAt',label:'생성일',kind:'datetime',editable:false},{field:'updatedAt',label:'수정일',kind:'datetime',editable:false}];
const pad=(value:number)=>String(value).padStart(2,'0');
export const localDate=(date:Date)=>`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
export const today=()=>localDate(new Date());
export const text=(value:unknown)=>typeof value==='string'?value:'';
export const dayOf=(value:unknown)=>text(value).slice(0,10);
export function dateFrom(value:string){const [year,month,day]=value.split('-').map(Number);return new Date(year,month-1,day,12);}
export function moveDate(value:string,days:number){const date=dateFrom(value);date.setDate(date.getDate()+days);return localDate(date);}
export function moveCalendarPeriod(value:string,view:'day'|'week'|'month',direction:number){const date=dateFrom(value);if(view==='month'){date.setDate(1);date.setMonth(date.getMonth()+direction);return localDate(date);}return moveDate(value,direction*(view==='week'?7:1));}
export function calendarDays(date:string,view:'day'|'week'|'month'):string[]{const anchor=dateFrom(date);if(view==='day')return [date];if(view==='month')anchor.setDate(1);anchor.setDate(anchor.getDate()-((anchor.getDay()+6)%7));return Array.from({length:view==='week'?7:42},(_,index)=>moveDate(localDate(anchor),index));}
export function noteScreenKey(context:NoteContext){
 if(context.requiresScreenSelection)return '';
 if(context.url&&context.pointInfo){const scalar=(key:string)=>{const value=context.pointInfo?.[key];return typeof value==='string'||typeof value==='number'?String(value):'';};return JSON.stringify([context.url,scalar('areaCd'),scalar('depth1'),scalar('depth2')]);}
 if(context.screenKey){try{const tuple=JSON.parse(context.screenKey);if(Array.isArray(tuple))return JSON.stringify(tuple.slice(0,4).map(value=>String(value??'')));}catch{}return context.screenKey;}
 return context.url?JSON.stringify([context.url,'','','']):'';
}
export function matchesNoteScreen(saved:unknown,current:string){if(!saved)return true;if(saved===current)return true;try{const tuple=JSON.parse(current);if(Array.isArray(tuple)&&saved===tuple[0])return true;}catch{}try{const left=JSON.parse(String(saved)),right=JSON.parse(current);return Array.isArray(left)&&Array.isArray(right)&&JSON.stringify(left.slice(0,4).map(v=>String(v??'')))===JSON.stringify(right.slice(0,4).map(v=>String(v??'')));}catch{return false;}}
export function visibleNotes(rows:TableRow[],screenKey:string,showOtherScreens=false){return rows.filter(row=>row.trashed!==true&&(showOtherScreens||matchesNoteScreen(row.screenKey,screenKey)));}
export function notesOnDate(rows:TableRow[],date:string){return rows.filter(row=>{const start=dayOf(row.start),end=dayOf(row.end)||start;return row.trashed!==true&&start&&start<=date&&date<=end;});}
export function blankDraft(date=today()):NoteDraft{return {title:'',body:'',screenKey:'',start:date,end:date,important:false,urgent:false,completed:false,color:'yellow',trashed:false};}
export function rowDraft(row:TableRow):NoteDraft{return {title:text(row.title),body:text(row.body),screenKey:text(row.screenKey),start:dayOf(row.start)||today(),end:dayOf(row.end)||dayOf(row.start)||today(),important:row.important===true,urgent:row.urgent===true,completed:row.completed===true,color:noteColors.some(c=>c.key===row.color)?String(row.color):'yellow',trashed:row.trashed===true};}
export function noteSaveValues(kind:NoteKind,draft:NoteDraft,original?:TableRow):Record<string,unknown>{
 const values:Record<string,unknown>={title:draft.title.trim(),body:draft.body,screenKey:draft.screenKey,important:draft.important,urgent:draft.urgent,completed:draft.completed,color:noteColors.some(c=>c.key===draft.color)?draft.color:'yellow',trashed:draft.trashed===true};
 if(kind==='schedules'){const valid=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&localDate(dateFrom(value))===value;if(!valid(draft.start)||!valid(draft.end)||draft.end<draft.start)throw Error('일정 시작일과 종료일을 확인하세요.');values.start=original&&dayOf(original.start)===draft.start?original.start:draft.start;values.end=original&&dayOf(original.end)===draft.end?original.end:draft.end;}
 return values;
}
export function noteLabel(row:Pick<NoteDraft,'title'|'body'>|TableRow){return text(row.title).trim()||text(row.body).split(/\r?\n/).find(line=>line.trim())?.trim()||'빈 메모';}
export function sortNotes<T extends TableRow>(rows:T[],sort:'updated'|'created'|'title'|'date'){return [...rows].sort((a,b)=>Number(b.important===true)-Number(a.important===true)||(sort==='title'?noteLabel(a).localeCompare(noteLabel(b),'ko'):sort==='date'?text(a.start).localeCompare(text(b.start)):text(b[sort==='created'?'createdAt':'updatedAt']).localeCompare(text(a[sort==='created'?'createdAt':'updatedAt']))));}
export function calendarSelection(selected:string[],date:string,extend:boolean,anchor?:string){if(extend&&anchor){const start=anchor<date?anchor:date,end=anchor>date?anchor:date;const result:string[]=[];for(let current=start;current<=end&&result.length<366;current=moveDate(current,1))result.push(current);return result;}return selected.includes(date)?selected.filter(d=>d!==date):[...selected,date].sort();}
