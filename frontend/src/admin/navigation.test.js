import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {useNavigation,readLocation} from './navigation';
let root,div,nav;
function Harness(){nav=useNavigation();return <span>{JSON.stringify(nav.route)}</span>;}
beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;window.history.replaceState(null,'','/');div=document.createElement('div');root=createRoot(div);});
afterEach(async()=>{await act(async()=>root.unmount());});
const back=async()=>act(async()=>{window.history.back();await new Promise(r=>setTimeout(r,30));});
test.each(['battle','cooking'])('game %s survives admin, detail and browser back',async tab=>{
 await act(async()=>root.render(<Harness/>));
 act(()=>nav.go({admin:false,tab}));act(()=>nav.go({admin:true,tab,menu:'dashboard'}));
 act(()=>nav.go({...nav.route,menu:'items'}));act(()=>nav.go({...nav.route,record:'4'}));
 expect(readLocation().record).toBe('4');await back();expect(nav.route.menu).toBe('items');expect(nav.route.record).toBeNull();
 await back();expect(nav.route.menu).toBe('dashboard');await back();expect(nav.route.admin).toBe(false);expect(nav.route.tab).toBe(tab);
});
test('refresh restores return tab and selected record; direct link has safe back fallback',async()=>{
 window.history.replaceState(null,'','/#admin/items?return=inventory&record=7');
 await act(async()=>root.render(<Harness/>));expect(nav.route.tab).toBe('inventory');expect(nav.route.record).toBe('7');
 act(()=>nav.back());expect(nav.route.record).toBeNull();act(()=>nav.back());expect(nav.route.menu).toBe('dashboard');act(()=>nav.back());expect(nav.route.admin).toBe(false);expect(nav.route.tab).toBe('inventory');
});
test('invalid URL values cannot select arbitrary endpoints or return locations',()=>{
 window.history.replaceState(null,'','/#admin/unknown?return=https://evil.test&record=../users');expect(readLocation()).toMatchObject({menu:'dashboard',tab:'home',record:null});
});

test('public roster URL and browser back preserve list route',async()=>{
 await act(async()=>root.render(<Harness/>));act(()=>nav.go({admin:false,tab:'roster'}));act(()=>nav.go({admin:false,tab:'roster',record:'12'}));expect(readLocation()).toMatchObject({admin:false,tab:'roster',record:'12'});await back();expect(nav.route).toMatchObject({tab:'roster',record:null});
});
