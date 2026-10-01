import {describe,it,expect} from 'vitest';
import {mergeGridEdits} from './editBuffer';
describe('Grid projection edit buffer',()=>{
 it('keeps hidden blank rows when a visible row is edited',()=>{expect(mergeGridEdits([{__rowId:'blank',name:''},{__rowId:'shown',name:'before'}],[{__rowId:'shown',name:'after'}])).toEqual([{__rowId:'blank',name:''},{__rowId:'shown',name:'after'}]);});
 it('only deletes explicit selected ids, preserving hidden columns and versions',()=>{expect(mergeGridEdits([{__rowId:'a',__storeVersion:2,name:'one',secret:'keep'},{__rowId:'b',name:'two'}],[{__rowId:'a',name:'changed',__virtual0:'presentation'}],['b'])).toEqual([{__rowId:'a',__storeVersion:2,name:'changed',secret:'keep'}]);});
});
