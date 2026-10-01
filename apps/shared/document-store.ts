import type { LocalDocument, PrototypeNamespace } from '../bookmarklet/contracts';
export interface DocumentStore {
 listDocuments<T>(namespace:PrototypeNamespace):Promise<LocalDocument<T>[]>;
 putDocument<T>(namespace:PrototypeNamespace,documentId:string,expectedVersion:number|null,value:T,expectedReferences?:{documentId:string;storeVersion:number}[]):Promise<LocalDocument<T>>;
 removeDocument(namespace:PrototypeNamespace,documentId:string,expectedVersion:number):Promise<void>;
}
