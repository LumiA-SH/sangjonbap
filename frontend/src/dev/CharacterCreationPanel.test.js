import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import CharacterCreationPanel from './CharacterCreationPanel';
test('unlinked identity explains OAuth linking without practice stats or approval',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;const div=document.createElement('div'),root=createRoot(div);
 await act(async()=>root.render(<CharacterCreationPanel/>));
 expect(div.querySelector('input')).toBeNull();expect(div.textContent).toContain('자동 연결');
 expect(div.textContent).not.toMatch(/심사|승인|연습/);await act(async()=>root.unmount());
});
