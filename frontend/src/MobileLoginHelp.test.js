import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import MobileLoginHelp from './MobileLoginHelp';
test('copies only clean game URL and explains fresh external browser login',async()=>{
    const container=document.createElement('div');const root=createRoot(container);
    const original=navigator.clipboard;
    const actEnvironment=global.IS_REACT_ACT_ENVIRONMENT;global.IS_REACT_ACT_ENVIRONMENT=true;
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:jest.fn().mockResolvedValue()}});
    try {
        act(()=>root.render(<MobileLoginHelp />));
        expect(container.textContent).toContain('Safari 또는 Chrome');
        expect(container.textContent).toContain('새로 로그인');
        await act(async()=>container.querySelector('button').click());
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://survivalbob.site/');
        expect(container.querySelector('[role="status"]').textContent).toContain('복사했습니다');
    } finally {act(()=>root.unmount());global.IS_REACT_ACT_ENVIRONMENT=actEnvironment;Object.defineProperty(navigator,'clipboard',{configurable:true,value:original});}
});
