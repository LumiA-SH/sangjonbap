import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import CharacterCreationPanel,{validateStatDraft} from './CharacterCreationPanel';
test('creation preview validates integer range but never grants or selects a grade',async()=>{
  expect(validateStatDraft({atk:9,def:20,agi:20})).toContain('10~20');
  expect(validateStatDraft({atk:10.5,def:10,agi:20})).toContain('정수');
  expect(validateStatDraft({atk:12,def:12,agi:12})).toContain('합계 36');
  global.IS_REACT_ACT_ENVIRONMENT=true;const div=document.createElement('div'),root=createRoot(div);
  await act(async()=>root.render(<CharacterCreationPanel/>));
  expect(div.querySelector('select')).toBeNull();expect(div.querySelector('button')).toBeNull();
  expect(div.textContent).toContain('저장되지 않습니다');await act(async()=>root.unmount());
});
