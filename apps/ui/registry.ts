import type {PluginDefinition} from '../../packages/contracts/src';
import {CapturePanel,RelationPanel,SettingsPanel,SqlPanel,BackupPanel} from './Panels';
export const workspacePlugins = [
 {id:'tables',label:'데이터 작업실',features:['table.read','grid.commit','dataset.create','table.configure'],dependencies:[]},
 {id:'captures',label:'수집 관리자',features:['capture.list','capture.import','collector.preview','collector.apply'],dependencies:['tables'],panel:CapturePanel},
 {id:'relations',label:'관계 관리자',features:['relation.list','relation.preview','relation.save','relation.query'],dependencies:['tables'],panel:RelationPanel},
 {id:'settings',label:'사전·설정',features:['settings.read','settings.save'],dependencies:[],panel:SettingsPanel},
 {id:'sql',label:'SQL 조회',features:['query.execute'],dependencies:['tables'],panel:SqlPanel},
 {id:'backup',label:'백업·복원',features:['backup.export','backup.preview','backup.restore'],dependencies:[],panel:BackupPanel},
] satisfies (PluginDefinition & {panel?:React.ComponentType<any>})[];
