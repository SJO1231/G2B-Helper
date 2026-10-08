/** MVP public contracts. Source field names and values are never display labels. */
export type ProcurementStage = 'receipt' | 'bid' | 'contract';
export type JsonRow = Record<string, unknown>;
export interface ScreenLocator { url: string; areaCd: string; depth1: string; depth2: string; depth3?: string; framePath: string; }
export interface CaptureScreenRule { id: string; stage: ProcurementStage; urlPattern: string; areaCd: string; depth1: string; depth2: string; depth3?: string; }
export interface NestedDataset { key: string; label: string; kind: 'items' | 'qualification' | 'other'; rows: JsonRow[]; }
export interface ProcurementObservation {
  stage: ProcurementStage; identity: string[]; fields: JsonRow; children: NestedDataset[];
  rawJson: string; source: ScreenLocator; capturedAt: string;
}
export interface ProcurementRecord extends ProcurementObservation { recordId: string; storeVersion: number; userValues: JsonRow; }
export interface ExtractionView { key: string; label: string; stage?: ProcurementStage; rows: JsonRow[]; source?: ScreenLocator; }
export interface ExtractionResult { raw: unknown; views: ExtractionView[]; observations: ProcurementObservation[]; warnings: string[]; }
/** A stored value the screen replaced on collection (#43): a source key, or ['children', key] with row counts for a child table. */
export interface FieldChange { recordId: string; field: string; previous: unknown; incoming: unknown; }
export interface CollectionPreview { token: string; observations: ProcurementObservation[]; changes: FieldChange[]; counts: { inserted: number; identical: number; supplemented: number; changed: number }; items: { recordId: string; status: 'inserted' | 'identical' | 'supplemented' | 'changed'; carriedFrom?: string }[]; }
export interface FieldDictionary { keys: Record<string, string>; values: Record<string, Record<string, string>>; }
export type MvpShortcutAction = 'extract' | 'collect' | 'db' | 'document' | 'launcher';
export const columnTypeLabels = { text: '텍스트', number: '숫자', money: '금액', percent: '백분율', date: '날짜', datetime: '날짜·시간', boolean: '체크값' } as const;
export type MvpColumnType = keyof typeof columnTypeLabels;
export interface MvpColumnFormat { decimals?: number; grouping?: boolean; dateFormat?: 'dot' | 'dash' | 'compact'; }
export type GridFilter = { mode: 'values'; values: string[] } | { mode: 'exact' | 'includes' | 'exclude'; terms: string[] };
export interface GridViewState { search: string; combine: 'and' | 'or'; filters: [string, GridFilter][]; columns: { key: string; width: number; visible: boolean }[]; sorters: { key: string; dir: 'asc' | 'desc' }[]; userColumnsVisible?: boolean; }
export interface MvpSettings { theme: 'light' | 'dark'; extractionMode: 'tables' | 'all'; hideEmptyColumns: boolean; hideUnmappedColumns: boolean; hideEmptyTables?: boolean; dictionary: FieldDictionary; launchers: { id: string; label: string; script: string }[]; shortcuts?: Partial<Record<MvpShortcutAction,string>>; columnTypes?: Record<string,MvpColumnType>; columnFormats?: Record<string,MvpColumnFormat>; screenRules?: CaptureScreenRule[]; userColumns?: Partial<Record<ProcurementStage,string[]>>; documentProfiles?: Partial<Record<ProcurementStage,string>>; documentLinks?: Partial<Record<ProcurementStage,Record<string,Record<string,string>>>>; }
export interface GridRendererOptions {
  label: string; rows: JsonRow[]; settings: MvpSettings; readOnly?: boolean;
  userColumnKeys?: string[];
  viewState?: GridViewState;
  itemColumnKeys?: string[];
  readOnlyColumnKeys?: string[];
  onRowsChanged?: (rows: JsonRow[], sourceIndices: number[]) => void; onColumnRename?: (key: string, label: string) => void;
  onColumnType?: (key: string, type: MvpColumnType) => void;
  onColumnFormat?: (key: string, format: MvpColumnFormat) => void;
  onNotice?: (message: string) => void;
  onValueDictionary?: (key: string, value: unknown, selection?: { key: string; value: unknown }[]) => void;
  allowRowDelete?: boolean;
  onDeleteRows?: (rows: JsonRow[], sourceIndices: number[]) => void;
  onUserColumnsChanged?: (keys: string[]) => void;
  onNested?: (row: JsonRow, key: string, rows: JsonRow[]) => void;
  /** Settings changed from the 속성 panel; `tableSettings` enables the 테이블 분류 controls (extraction only). */
  onSettings?: (changes: Partial<Pick<MvpSettings, 'hideEmptyColumns' | 'hideUnmappedColumns' | 'hideEmptyTables' | 'extractionMode'>>) => void;
  tableSettings?: boolean;
}
export interface GridRendererHandle {
  rows(): JsonRow[]; setSearch(search: string): void; clearColumnFilters(): void; setSettings(settings: MvpSettings): void;
  getSelectedRows(): { sourceIndex: number; row: JsonRow }[];
  setRowFilter(predicate?: (row: JsonRow) => boolean): void;
  setUserColumnsVisible(visible: boolean): void;
  toggleSelectedBoolean(key: string): void;
  updateDerivedValues(compute: (row: JsonRow) => JsonRow): void;
  getViewState(): GridViewState;
  addColumn(key: string): void; removeColumn(key: string): void; exportExcel(filename: string): void; exportCsv(filename: string): void;
  destroy(): void;
}
export type MvpRpcCommand = 'mvp.health' | 'mvp.preview' | 'mvp.apply' | 'mvp.records' | 'mvp.edit' | 'mvp.trash' | 'mvp.restore' | 'mvp.settings.read' | 'mvp.settings.save' | 'mvp.document.profiles' | 'mvp.document.generate';
export interface DocumentItem { stage: ProcurementStage; identity: string[]; fields: JsonRow; userValues: JsonRow; children: NestedDataset[]; source: ScreenLocator | JsonRow; }
export interface DocumentProfile { id: string; label: string; revisionId: number; outputDirectory: string; }
export interface DocumentRequest { profileId: string; sourceKind: 'screen' | 'db'; items: DocumentItem[]; }
export interface DocumentResult { requestId: string; status: 'success' | 'needs-input' | 'error' | 'partial'; results: { itemIndex: number; status: 'success' | 'needs-input' | 'error'; path?: string; code?: string; message?: string; missingFields?: string[]; conflicts?: string[] }[]; summary: { succeeded: number; needsInput: number; failed: number }; }
export interface MvpEnvelope { protocolVersion: 1; requestId: string; command: MvpRpcCommand; payload: Record<string, unknown>; }
export interface MvpResponse { protocolVersion: 1; requestId: string; result?: unknown; error?: { code: string; message: string }; }
