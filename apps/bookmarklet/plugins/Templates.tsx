import type {BookmarkletPlugin,PrototypeServices} from '../contracts';
import * as documents from '../storage';
import {TemplatesPanel as SharedPanel} from '../../shared/Templates';
export function TemplatesPanel({services}:{services:PrototypeServices}){return <SharedPanel services={services} documents={documents}/>;}
export const templatesPlugin:BookmarkletPlugin={id:'prototype.templates',label:'텍스트 템플릿',features:['templates'],component:TemplatesPanel};
