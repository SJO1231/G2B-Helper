import type {BookmarkletPlugin,PrototypeServices} from '../contracts';
import * as documents from '../storage';
import {HwpxPanel as SharedPanel} from '../../shared/Hwpx';
export function HwpxPanel({services}:{services:PrototypeServices}){return <SharedPanel services={services} documents={documents}/>;}
export const hwpxPlugin:BookmarkletPlugin={id:'prototype.hwpx',label:'HWPX 문서',features:['templates'],component:HwpxPanel};
