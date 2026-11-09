import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import DonationPanel from './DonationPanel';
import {api} from '../api/client';
jest.mock('../api/client',()=>({api:jest.fn()}));
jest.mock('./CharacterSearch',()=>({onSelect})=><button onClick={()=>onSelect('2')}>대상 선택</button>);
let root,container;
beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;Object.defineProperty(global,'crypto',{configurable:true,value:{randomUUID:()=> '12345678-1234-4234-8234-123456789012'}});api.mockReset();container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
const click=async text=>act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent===text).click());
test('preview does not donate until confirmation and retry preserves request key',async()=>{
 const preview={targetId:'2',targetName:'수혜자',cost:10,recovery:5,settings:{}};
 api.mockResolvedValueOnce(preview).mockRejectedValueOnce({code:'API_TIMEOUT',message:'재시도'}).mockResolvedValueOnce(preview);
 const refresh=jest.fn();await act(async()=>root.render(<DonationPanel character={{status:'ALIVE'}} refresh={refresh}/>));
 await click('대상 선택');await click('헌혈 조건 확인');expect(api).toHaveBeenCalledTimes(1);expect(container.textContent).toContain('대상 혈량 5 회복');
 await click('확인 후 헌혈');await click('확인 후 헌혈');expect(api.mock.calls[1][1].body.requestKey).toBe(api.mock.calls[2][1].body.requestKey);expect(refresh).toHaveBeenCalledTimes(1);
});
