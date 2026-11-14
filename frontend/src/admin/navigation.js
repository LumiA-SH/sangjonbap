import {useEffect, useState} from 'react';

export const gameTabs = [
 'home', 'world', 'system', 'schedule', 'roster', 'character',
 'investigation', 'battle', 'cooking', 'inventory', 'shop', 'records', 'gacha'
];

export const adminMenus = [
 ['dashboard', '운영 대시보드'],
 ['guide-world', '세계관 관리'],
 ['guide-system', '시스템 안내 관리'],
 ['guide-schedule', '러닝 일정 관리'],
 ['items', '아이템'],
 ['products', '상점 상품'],
 ['foods', '음식 설정'],
 ['food-grades', '음식 등급'],
 ['recipes', '레시피'],
 ['gachas', '가챠'],
 ['area-hub', '구역 통합 관리'],
 ['areas', '지역 공개·조우'],
 ['investigation', '조사 결과·보상'],
 ['storage', '공용창고 재고'],
 ['clues', '단서 관리'],
 ['characters', '캐릭터 운영 관리'],
 ['balance', '공통 밸런스'],
 ['policies', '운영 정책'],
 ['battle', '마물 등록'],
 ['users', '관리자 권한'],
 ['diagnostics', '데이터 진단'],
 ['logs', '전체 행동 로그']
];

export function readLocation() {
 const [path, query = ''] = window.location.hash.slice(1).split('?');
 const params = new URLSearchParams(query);
 const tab = gameTabs.includes(params.get('return')) ? params.get('return') : 'home';

 if (path === 'admin' || path.startsWith('admin/')) {
  return {
   admin: true,
   tab,
   menu: adminMenus.some(([id]) => id === path.split('/')[1])
       ? path.split('/')[1]
       : 'dashboard',
   area: /^[1-9][0-9]*$/.test(params.get('area') || '')
       ? params.get('area')
       : null,
   after: /^[1-9][0-9]*$/.test(params.get('after') || '')
       ? params.get('after')
       : null,
   record: /^(new|[1-9][0-9]*)$/.test(params.get('record') || '')
       ? params.get('record')
       : null
  };
 }

 return {
  admin: false,
  tab: gameTabs.includes(path.split('/')[1])
      ? path.split('/')[1]
      : 'home',
  menu: 'dashboard',
  record: path === 'game/roster' &&
  /^[1-9][0-9]*$/.test(params.get('record') || '')
      ? params.get('record')
      : null
 };
}

export function useNavigation() {
 const [route, setRoute] = useState(readLocation);

 useEffect(() => {
  const update = () => setRoute(readLocation());

  window.addEventListener('popstate', update);
  window.addEventListener('hashchange', update);

  return () => {
   window.removeEventListener('popstate', update);
   window.removeEventListener('hashchange', update);
  };
 }, []);

 function go(next, replace = false) {
  const hash = next.admin
      ? `#admin/${next.menu || 'dashboard'}?return=${next.tab}${next.area ? '&area=' + next.area : ''}${next.after ? '&after=' + next.after : ''}${next.record ? '&record=' + next.record : ''}`
      : `#game/${next.tab}${next.tab === 'roster' && next.record ? '?record=' + next.record : ''}`;

  const depth = replace
      ? (window.history.state?.adminDepth || 0)
      : (next.admin ? (window.history.state?.adminDepth || 0) + 1 : 0);

  window.history[replace ? 'replaceState' : 'pushState'](
      {...window.history.state, adminDepth: depth},
      '',
      hash
  );

  setRoute(readLocation());
 }

 function back() {
  if (window.history.state?.adminDepth > 0) {
   window.history.back();
  } else if (route.record) {
   go({...route, record: null}, true);
  } else if (route.menu !== 'dashboard') {
   go({...route, menu: 'dashboard', record: null}, true);
  } else {
   go({...route, admin: false}, true);
  }
 }

 return {route, go, back};
}