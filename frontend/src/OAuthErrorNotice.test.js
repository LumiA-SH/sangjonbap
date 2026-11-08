import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import OAuthErrorNotice from './OAuthErrorNotice';
test('safe callback notice clears fragment, renders fixed message and survives rerender',()=>{
  global.IS_REACT_ACT_ENVIRONMENT=true;
  const div=document.createElement('div'),root=createRoot(div);
  window.history.replaceState(null,'','/#oauth_error=OAUTH_DENIED');
  try{
    act(()=>root.render(<OAuthErrorNotice/>));
    expect(div.textContent).toContain('취소되었습니다');expect(window.location.hash).toBe('');
    act(()=>root.render(<OAuthErrorNotice/>));expect(div.textContent).toContain('취소되었습니다');
  }finally{act(()=>root.unmount());}
});
test('unknown URL values are never echoed or treated as authentication',()=>{
  global.IS_REACT_ACT_ENVIRONMENT=true;
  const div=document.createElement('div'),root=createRoot(div);
  window.history.replaceState(null,'','/#oauth_error=private-injected-value');
  try{act(()=>root.render(<OAuthErrorNotice/>));expect(div.textContent).toContain('완료하지 못했습니다');expect(div.textContent).not.toContain('private-injected-value');expect(window.location.hash).toBe('');}
  finally{act(()=>root.unmount());}
});
