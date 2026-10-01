import {useEffect,useState} from 'react';
import {request} from '../../../plugins/core/gateway';
import {extensionCommand} from '../transport';
import {applyTheme} from '../theme';
export function AppearancePopup({report}:{report:(value:string)=>void}){
 const [theme,setTheme]=useState('light'),[version,setVersion]=useState<number|null>(null),[busy,setBusy]=useState(false);
 useEffect(()=>{request('settings.read',{key:'ui.appearance'}).then(result=>{setTheme(result.value?.theme||'light');setVersion(result.storeVersion);}).catch(error=>report(String(error)));},[]);
 async function save(value:string){try{setBusy(true);const result=await request('settings.save',{key:'ui.appearance',value:{theme:value},storeVersion:version});setTheme(value);setVersion(result.storeVersion);applyTheme(document.documentElement,value);await extensionCommand({type:'ui.refresh'});report('테마를 저장했습니다.');}catch(error){report(String(error));}finally{setBusy(false);}}
 return <div className="feature-content appearance-settings"><h2>화면</h2><div className="row">{[['light','화이트'],['dark','블랙']].map(([value,label])=><button key={value} aria-pressed={theme===value} className={theme===value?'active':''} disabled={version===null||busy} onClick={()=>save(value)}>{label}</button>)}</div></div>;
}
