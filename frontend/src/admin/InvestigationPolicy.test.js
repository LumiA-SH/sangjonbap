import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
import InvestigationAdminPanel from './InvestigationAdminPanel';
import DiagnosticsPanel from './DiagnosticsPanel';
import {api} from '../api/client';
jest.mock('../api/client',()=>({api:jest.fn()}));
let root,container;
beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;Object.defineProperty(global,'crypto',{configurable:true,value:{randomUUID:()=> '12345678-1234-4234-8234-123456789012'}});api.mockReset();container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
test('investigation failure classification and inclusion are separate saved settings',async()=>{
 let record={id:'2',result_grade:'NORMAL',result_text:'결과',weight:1,is_unique:false,investigation_rate_value:0,clue_id:null,is_active:true,is_failure:false,failure_selectable:true,rewards:[]};
 api.mockImplementation(async(url,options)=>{if(options){record={...record,...options.body};return {record};}if(url==='/admin/areas')return {records:[{id:'1',name:'지역'}]};if(url==='/admin/recipes')return {records:[]};return {results:[record],clues:[]};});
 await act(async()=>root.render(<InvestigationAdminPanel onDenied={jest.fn()}/>));
 await act(async()=>Simulate.change(container.querySelector('select'),{target:{value:'1'}}));
 await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='결과 수정').click());
 const field=label=>[...container.querySelectorAll('label')].find(l=>l.textContent===label).querySelector('input');
 await act(async()=>Simulate.change(field('실패 결과'),{target:{checked:true}}));
 await act(async()=>Simulate.change(field('실패 결과도 선택에 포함'),{target:{checked:false}}));
 await act(async()=>Simulate.submit(container.querySelector('form')));
 expect(api).toHaveBeenCalledWith('/admin/areas/1/results/2',expect.objectContaining({method:'PATCH',body:expect.objectContaining({is_failure:true,failure_selectable:false})}));
 expect(container.textContent).toContain('조사 설정 저장 성공');
});
test('diagnostic UI offers read-only lookup and no recovery execution',async()=>{
 api.mockResolvedValue({recipes:[],gachas:[],battles:[],sharedFailureItems:[],recoveryEnabled:false});
 await act(async()=>root.render(<DiagnosticsPanel onDenied={jest.fn()}/>));await act(async()=>container.querySelector('button').click());
 expect(api).toHaveBeenCalledWith('/admin/diagnostics');expect(api).toHaveBeenCalledTimes(1);expect(container.textContent).toContain('복구·삭제는 실행하지 않습니다');
});

test('investigation route restores region and result; cancel preserves region and list',async()=>{
 const record={id:'2',result_grade:'NORMAL',result_text:'결과',weight:1,is_unique:false,investigation_rate_value:0,clue_id:null,is_active:true,is_failure:false,failure_selectable:true,rewards:[]};
 api.mockImplementation(async path=>path==='/admin/areas'?{records:[{id:'1',name:'지역'}]}:path==='/admin/recipes'?{records:[]}:{results:[record],clues:[]});
 const onNavigate=jest.fn(),onDenied=jest.fn();await act(async()=>root.render(<InvestigationAdminPanel onDenied={onDenied} onNavigate={onNavigate} route={{area:'1',record:'2'}}/>));
 expect(container.textContent).toContain('결과 2 수정');expect(container.querySelector('select').value).toBe('1');
 await act(async()=>root.render(<InvestigationAdminPanel onDenied={onDenied} onNavigate={onNavigate} route={{area:'1',record:null}}/>));expect(container.querySelector('form')).toBeNull();expect(container.textContent).toContain('결과 수정');
});
