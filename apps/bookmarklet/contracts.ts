import type { ComponentType } from 'react';
import type { CapturePayload, ColumnDefinition, PluginDefinition, TableRow } from '../../packages/contracts/src/index';
import type { TemplateProgram } from '../../plugins/template/index';

export type PrototypeNamespace = 'datasets' | 'notes' | 'launchers' | 'templates' | 'relations' | 'hwpx-templates';
export interface LocalDocument<T> { documentId: string; namespace: PrototypeNamespace; storeVersion: number; value: T; }
export interface PrototypeDataset { name: string; category: 'reference' | 'collected'; columns: ColumnDefinition[]; rows: TableRow[]; }
export interface PrototypeNote { title: string; body: string; kind: 'memo' | 'schedule'; scope: 'general' | 'screen' | 'record'; screenUrl?: string; datasetId?: string; rowId?: string; startsOn?: string; endsOn?: string; done: boolean; }
export interface PrototypeLauncher { name: string; kind: 'url' | 'script'; target: string; }
export interface PrototypeTemplate { name: string; body: string; program?: TemplateProgram; }
export interface PrototypeSelection { datasetId: string; datasetName: string; rowId: string; values: Record<string, unknown>; }
export interface PrototypeServices {
  notify(message: string): void;
  selection: PrototypeSelection | null;
  select(selection: PrototypeSelection | null): void;
  navigate(tab: string): void;
  datasets(): Promise<LocalDocument<PrototypeDataset>[]>;
}
export interface BookmarkletPlugin extends PluginDefinition { component: ComponentType<{ services: PrototypeServices }>; }
export interface CollectorPanelHandle { close(): Promise<void>; pause(): Promise<void>; }
export interface CollectorPanelOptions { onDataset?(name: string, rows: Record<string, unknown>[]): Promise<void>; }
export type { CapturePayload };
