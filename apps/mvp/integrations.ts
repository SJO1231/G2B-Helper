import type { ProcurementObservation } from './contracts';
export interface CollectorBridge { sendCollectedData(payload:ProcurementObservation[]):Promise<void>; }
export const collectorBridge:CollectorBridge={async sendCollectedData(payload){window.dispatchEvent(new CustomEvent('g2b-helper:collected',{detail:structuredClone(payload)}));}};
export function documentPayload(source:unknown){return{format:'g2b-helper-document',version:1,source};}
