export const PROTOCOL_VERSION = 1;
export type FieldKind = 'text' | 'integer' | 'decimal' | 'boolean' | 'date' | 'datetime' | 'code' | 'json';
export interface ColumnDefinition { field: string; label: string; kind: FieldKind; editable?: boolean; required?: boolean; values?: Record<string,string>; }
export interface TableRow { __rowId: string; __storeVersion: number; [field: string]: unknown; }
export interface TableSummary { sourceId: string; label: string; group: string; editable: boolean; rowCount?: number; }
export interface TableSource extends TableSummary { columns: ColumnDefinition[]; rows: TableRow[]; rowCount: number; offset?: number; hasMore?: boolean; }
export interface GridEditBatch { columns?: ColumnDefinition[]; added: Record<string,unknown>[]; updated: {rowId:string; storeVersion:number; values:Record<string,unknown>}[]; deleted: {rowId:string;storeVersion:number}[]; }
export interface GatewayClient { request<T = unknown>(command:string, payload?:Record<string,unknown>):Promise<T>; }
export interface GatewayRequest { protocolVersion:1; requestId:string; command:string; payload:Record<string,unknown>; }
export interface GatewayError { code:string; message:string; details?:unknown; }
export interface GatewayResponse<T=unknown> { protocolVersion:1; requestId:string; result?:T; error?:GatewayError; }
export interface PluginDefinition { id:string; label:string; features:string[]; dependencies?:string[]; }
export type ProcurementStage = 'receipt' | 'bid' | 'contract';
export interface ProcurementIdentity { stage:ProcurementStage; businessNumber:string; businessOrder:string; }
export interface CapturePayload { pointInfo:Record<string,unknown>; tables:Record<string,Record<string,unknown>[]>; url?:string; tableSources?:Record<string,{componentId:string;originalId:string}>; frames?:{framePath:string;url:string;pointInfo:Record<string,unknown>;tables:Record<string,Record<string,unknown>[]>;tableSources?:Record<string,{componentId:string;originalId:string}>}[]; warnings?:string[]; }
export interface CaptureEvent { captureId:string; capturedAt:string; classification:string; warnings:string[]; }
export interface FieldChangeProposal { field:string; previous:unknown; incoming:unknown; conflict:boolean; }
export interface ProposedRecord { recordKey:string; sourceId:string; identity:Record<string,unknown>; storeVersion:number|null; isNew:boolean; changes:FieldChangeProposal[]; }
export interface CollectionProposal { captureId:string; previewToken:string; classification:string; status:'ready'|'raw_only'|'ambiguous'; warnings:string[]; records:ProposedRecord[]; }
export interface QueryResult { columns:ColumnDefinition[]; rows:Record<string,unknown>[]; rowCount:number; metadata:{truncated:boolean;elapsedMs:number;[key:string]:unknown}; }
export type PanelActionKind = 'builtin'|'url'|'internal'|'script';
export interface PanelAction { id:string; name:string; icon:string; kind:PanelActionKind; target:string; createdPosition:number; }
export interface ScriptDefinition { id:string;name:string;code:string;matches:string[];enabled:boolean;automatic:boolean; }
export type FilterOperator='contains'|'notContains'|'equals'|'notEquals'|'gt'|'gte'|'lt'|'lte'|'empty'|'notEmpty';
export interface FilterCondition { field:string;path?:string[];operator:FilterOperator;values:string[];includeEmpty?:boolean;compareAs?:'raw'|'label'; }
export interface FilterGroup { join:'and'|'or'; conditions:(FilterCondition|FilterGroup)[]; }
export interface DuplicatePolicy { mode:'allow'|'skip'|'compare'; keys:string[]; }
export interface RelationDefinition { id:string;name:string;leftSourceId:string;rightSourceId:string;fieldPairs:{left:string;right:string}[];cardinality:'one'|'many';filter?:FilterGroup;storeVersion?:number; }
export interface JsonPresentation { mode:'summary'|'tree'|'raw'|'path'|'array';path?:string[];label?:string;missingLabel?:string;nullLabel?:string; }
export interface CollectionRule { sourceId:string;dataset:string;identityFields:string[];enabled?:boolean;screenFilter?:FilterGroup|FilterCondition;urlFilter?:FilterGroup|FilterCondition; }
export interface CollectionPolicy { version:1;storeVersion:number;rules:CollectionRule[]|null;includeDefaults?:boolean; }
export interface CollectionScope { allowed:boolean;status:'allowed'|'unconfigured'|'identity_missing'|'ambiguous'|'invalid_policy';reason:string;filteredPayload?:CapturePayload; }
export interface TransferCapture { captureId:string;capturedAt:string;origin:string;payload:CapturePayload;templateId?:string;purpose?:'collection'|'extraction-save'; }
export interface TransferBundle { format:'pce-transfer';version:1;exportedAt:string;origin:string;captures:TransferCapture[];settingsReferences?:unknown; }
