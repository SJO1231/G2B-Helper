import {it,expect,vi} from 'vitest';
vi.mock('../apps/extension/transport',()=>({extensionCommand:vi.fn()}));
import {capturedFrameRows} from '../apps/extension/features/Collection';
it('lists original frame origins without inventing executable links or flattening zero/false values',()=>{
 const original={payload:{frames:[{framePath:'frame:0/top',url:'https://www.g2b.go.kr/',pointInfo:{code:'01',enabled:false,qty:0},tables:{goods:[{a:1},{a:1}]},fieldSources:{code:{componentId:'c',ref:'code'}},warnings:['부분 읽기']}]}};const before=structuredClone(original);const rows=capturedFrameRows(original);expect(rows).toHaveLength(1);expect(rows[0].rowCount).toBe(2);expect(rows[0].pointInfo).toEqual({code:'01',enabled:false,qty:0});expect(rows[0].url).toBe('https://www.g2b.go.kr/');expect(rows[0]).not.toHaveProperty('directLink');expect(original).toEqual(before);
});
it('legacy raw captures expose only their actual metadata',()=>{
 expect(capturedFrameRows({origin:'https://fixture.test',payload:{pointInfo:{x:false},tables:{one:[{x:0}]}}})[0].url).toBe('https://fixture.test');expect(capturedFrameRows(null)).toEqual([]);
});
