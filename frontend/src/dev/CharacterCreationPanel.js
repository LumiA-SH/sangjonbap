import {useState} from 'react';

export function validateStatDraft(stats) {
  const values=['atk','def','agi'].map(k=>stats[k]);
  if(values.some(v=>!Number.isInteger(v)||v<10||v>20))return '각 스탯은 10~20의 정수여야 합니다.';
  const sum=values.reduce((a,b)=>a+b,0);
  if(![36,40,46].includes(sum))return `합계 ${sum}: B 36 / A 40 / S 46 중 어느 기준과도 일치하지 않습니다.`;
  return `합계 ${sum} / B 필요 36 · A 필요 40 · S 필요 46. 등급은 아직 부여되지 않았습니다.`;
}
export default function CharacterCreationPanel() {
  const [stats,setStats]=useState({atk:'',def:'',agi:''});
  return <section><h2>캐릭터 생성 준비</h2>
    <p>캐릭터는 운영진 심사 후 관리자가 확정 등급과 스탯을 등록합니다. 이 화면의 연습 입력값은 저장되지 않습니다.</p>
    <p>나이·직업·포지션·프로필 URL 입력은 고객 정책 확정 후 연결합니다.</p>
    {['atk','def','agi'].map(k=><label key={k}>{k.toUpperCase()}<input type="number" min="10" max="20" step="1" value={stats[k]}
      onChange={e=>setStats({...stats,[k]:e.target.value===''?'':Number(e.target.value)})}/></label>)}
    <p role="status">{validateStatDraft(stats)}</p>
  </section>;
}
