import {useContext,useEffect,useRef,useState} from 'react';
import {api} from '../api/client';
import CharacterSearch from './CharacterSearch';
import {AnemiaPolicyContext,characterStateText} from '../public/AnemiaNotice';
import './PublicCharacterPanel.css';

const VITAL_STATS = [
 {name:'HP',key:'hp',max:'max_hp',type:'hp'},
 {name:'혈량',key:'blood',max:'max_blood',type:'blood'},
 {name:'AP',key:'ap',max:'max_ap',type:'ap'}
];

const BATTLE_STATS = [
 {name:'ATK',key:'atk',label:'공격력'},
 {name:'DEF',key:'def',label:'방어력'},
 {name:'AGI',key:'agi',label:'민첩성'}
];

function getPercent(value,max) {
 const current=Number(value);
 const maximum=Number(max);

 if(!Number.isFinite(current)||!Number.isFinite(maximum)||maximum<=0) {
  return 0;
 }

 return Math.max(0,Math.min(100,current/maximum*100));
}

export default function PublicCharacterPanel({targetId}) {
 const anemiaPolicy=useContext(AnemiaPolicyContext);
 const [data,setData]=useState(null);
 const [pending,setPending]=useState(false);
 const [error,setError]=useState('');
 const current=useRef(null);

 async function load(id) {
  const token={};
  current.current=token;
  setData(null);
  setError('');
  setPending(true);

  try {
   const result=await api(`/characters/${id}/public`);

   if(current.current===token) {
    setData(result);
   }
  } catch(e) {
   if(current.current===token) {
    setError(`${e.code||'CHARACTER_READ_FAILED'}: ${e.message}`);
   }
  } finally {
   if(current.current===token) {
    setPending(false);
   }
  }
 }

 useEffect(()=>{
  if(targetId)load(targetId);

  return ()=>{
   current.current=null;
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[targetId]);

 const character=data?.character;
 const inventory=data?.inventory||[];

 return (
     <section className="public-character-panel" aria-label="캐릭터 상세 정보">
      <div className="public-character-panel__heading">
       <div>
        <span className="public-character-panel__eyebrow">SURVIVOR INFORMATION</span>
        <h3>캐릭터 상세 정보</h3>
       </div>

       {character?.in_active_battle&&(
           <span className="public-character-panel__battle-badge">전투 중</span>
       )}
      </div>

      {!targetId&&(
          <CharacterSearch
              inputId="public-character-search"
              label="조회할 캐릭터 이름 검색"
              busy={pending}
              onSelect={load}
          />
      )}

      {pending&&<p role="status">조회 중…</p>}
      {error&&<p role="alert">{error}</p>}

      {character&&(
          <div className="public-character-panel__content">
           {!targetId&&(
               <div className="public-character-panel__identity">
                <strong>{character.name}</strong>
                <span>상태: {characterStateText(character,anemiaPolicy)}</span>
               </div>
           )}

           <div className="public-character-panel__grid">
            <section className="public-character-panel__card">
             <div className="public-character-panel__card-heading">
              <span className="public-character-panel__eyebrow">VITAL STATUS</span>
              <h4>생존 상태</h4>
             </div>

             <dl className="public-character-panel__vitals">
              {VITAL_STATS.map(stat=>{
               const value=character[stat.key];
               const max=character[stat.max];
               const percent=getPercent(value,max);

               return (
                   <div className="public-character-panel__vital" key={stat.key}>
                    <div className="public-character-panel__vital-info">
                     <dt>{stat.name}</dt>
                     <dd>
                      <strong>{value??'-'}</strong>
                      <span> / {max??'-'}</span>
                     </dd>
                    </div>

                    <div className={`public-character-panel__progress public-character-panel__progress--${stat.type}`} aria-hidden="true">
                     <div className="public-character-panel__progress-fill" style={{width:`${percent}%`}} />
                    </div>
                   </div>
               );
              })}
             </dl>
            </section>

            <section className="public-character-panel__card">
             <div className="public-character-panel__card-heading">
              <span className="public-character-panel__eyebrow">COMBAT STATUS</span>
              <h4>전투 능력치</h4>
             </div>

             <dl className="public-character-panel__battle-stats">
              {BATTLE_STATS.map(stat=>(
                  <div className="public-character-panel__battle-stat" key={stat.key}>
                   <dt>{stat.name}</dt>
                   <dd>{character[stat.key]??'-'}</dd>
                   <span>{stat.label}</span>
                  </div>
              ))}
             </dl>
            </section>
           </div>

           <section className="public-character-panel__card public-character-panel__inventory">
            <div className="public-character-panel__card-heading">
             <div>
              <span className="public-character-panel__eyebrow">INVENTORY</span>
              <h4>소지품</h4>
             </div>

             <span className="public-character-panel__inventory-count">
                                {inventory.length}종
                            </span>
            </div>

            {inventory.length?(
                <ul className="public-character-panel__item-list">
                 {inventory.map(item=>(
                     <li className="public-character-panel__item" key={item.itemId}>
                      <span className="public-character-panel__item-name">{item.name}</span>
                      <span className="public-character-panel__item-quantity">× {item.quantity}</span>
                     </li>
                 ))}
                </ul>
            ):(
                <div className="public-character-panel__empty">
                 소지품이 없습니다.
                </div>
            )}
           </section>

           <p className="public-character-panel__notice">
            공개 정보 조회 전용입니다. 다른 캐릭터의 데이터는 수정할 수 없습니다.
           </p>
          </div>
      )}
     </section>
 );
}