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
export interface ExtractionView { key: string; label: string; stage?: ProcurementStage; rows: JsonRow[]; }
export interface ExtractionResult { raw: unknown; views: ExtractionView[]; observations: ProcurementObservation[]; warnings: string[]; }
export interface FieldConflict { recordId: string; field: string; previous: unknown; incoming: unknown; }
export interface CollectionPreview { token: string; observations: ProcurementObservation[]; conflicts: FieldConflict[]; counts: { inserted: number; identical: number; supplemented: number; changed: number }; }
export interface CollectionDecision { recordId: string; field: string; useIncoming: boolean; }
export interface FieldDictionary { keys: Record<string, string>; values: Record<string, Record<string, string>>; }
export type MvpShortcutAction = 'extract' | 'collect' | 'db' | 'document' | 'launcher';
export type MvpColumnType = 'text' | 'money' | 'date';
export interface MvpSettings { theme: 'light' | 'dark'; extractionMode: 'tables' | 'all'; hideEmptyColumns: boolean; hideUnmappedColumns: boolean; hideEmptyTables?: boolean; dictionary: FieldDictionary; launchers: { id: string; label: string; script: string }[]; shortcuts?: Partial<Record<MvpShortcutAction,string>>; columnTypes?: Record<string,MvpColumnType>; columnLocks?: Record<string,boolean>; screenRules?: CaptureScreenRule[]; userColumns?: Partial<Record<ProcurementStage,string[]>>; }
export interface GridRendererOptions {
  label: string; rows: JsonRow[]; settings: MvpSettings; readOnly?: boolean;
  userColumnKeys?: string[];
  itemColumnKeys?: string[];
  readOnlyColumnKeys?: string[];
  onRowsChanged?: (rows: JsonRow[]) => void; onColumnRename?: (key: string, label: string) => void;
  onColumnType?: (key: string, type: MvpColumnType) => void;
  onColumnLock?: (key: string, locked: boolean) => void;
  onNotice?: (message: string) => void;
  onValueDictionary?: (key: string, value: unknown) => void;
  allowRowDelete?: boolean;
  onDeleteRows?: (rows: JsonRow[], sourceIndices: number[]) => void;
  onUserColumnsChanged?: (keys: string[]) => void;
  onNested?: (row: JsonRow, key: string, rows: JsonRow[]) => void;
}
export interface GridRendererHandle {
  rows(): JsonRow[]; setSearch(search: string): void; setSettings(settings: MvpSettings): void;
  setRowFilter(predicate?: (row: JsonRow) => boolean): void;
  setUserColumnsVisible(visible: boolean): void;
  toggleSelectedBoolean(key: string): void;
  updateDerivedValues(compute: (row: JsonRow) => JsonRow): void;
  addColumn(key: string): void; removeColumn(key: string): void; exportExcel(filename: string): void;
  destroy(): void;
}
export type MvpRpcCommand = 'mvp.health' | 'mvp.preview' | 'mvp.apply' | 'mvp.records' | 'mvp.edit' | 'mvp.trash' | 'mvp.restore' | 'mvp.settings.read' | 'mvp.settings.save';
export interface MvpEnvelope { protocolVersion: 1; requestId: string; command: MvpRpcCommand; payload: Record<string, unknown>; }
export interface MvpResponse { protocolVersion: 1; requestId: string; result?: unknown; error?: { code: string; message: string }; }
