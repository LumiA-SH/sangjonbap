import {useEffect, useRef, useState} from 'react';
import {api} from '../api/client';
import {publicAsset} from '../publicAsset';
import PublicCharacterPanel from '../dev/PublicCharacterPanel';
import './public.css';

const FALLBACK_AVATAR = publicAsset('assets/decor/icon-user.svg');

const statusNames = {
 ALIVE: '생존',
 NEAR_DEATH: '빈사',
 DEAD: '사망'
};

function CharacterAvatar({character, large = false}) {
 const source = character?.profile_image_url || character?.image_url || '';
 const [failed, setFailed] = useState(false);

 useEffect(() => {
  setFailed(false);
 }, [source]);

 const validSource = typeof source === 'string' &&
     (/^https?:\/\//i.test(source) || /^\/(?!\/)/.test(source));

 const image = validSource && !failed ? source : FALLBACK_AVATAR;
 const fallback = image === FALLBACK_AVATAR;

 return (
     <div className={`public-character-avatar${large ? ' is-large' : ''}${fallback ? ' is-fallback' : ''}`}>
      <img
          src={image}
          alt={`${character?.name || '캐릭터'} 프로필`}
          loading="lazy"
          onError={() => setFailed(true)}
      />
     </div>
 );
}

function CharacterInformation({character}) {
 return (
     <div className="public-character-information">
            <span>
                헌터등급 <strong>{character.hunter_grade || '미설정'}</strong>
            </span>

      <span>
                이능등급 <strong>
                    {character.has_ability
                        ? (character.ability_grade || '미설정')
                        : '없음'}
                </strong>
            </span>

      <span className={`public-character-status status-${String(character.status || '').toLowerCase()}`}>
                상태 <strong>{statusNames[character.status] || character.status || '미확인'}</strong>
            </span>
     </div>
 );
}

export default function CharacterDirectory({recordId, onOpen, onBack, canReadDetails}) {
 const [query, setQuery] = useState('');
 const [rows, setRows] = useState([]);
 const [next, setNext] = useState(null);
 const [record, setRecord] = useState(null);
 const [error, setError] = useState('');
 const [detailError, setDetailError] = useState('');
 const [busy, setBusy] = useState(false);
 const [detailBusy, setDetailBusy] = useState(false);

 const sequence = useRef(0);

 async function search(after = null) {
  const token = ++sequence.current;

  setBusy(true);
  setError('');

  try {
   const params = new URLSearchParams({q: query});

   if (after) {
    params.set('after', after);
   }

   const result = await api(`/public/characters?${params.toString()}`);

   if (token !== sequence.current) return;

   setRows(result.records || []);
   setNext(result.nextAfter || null);
  } catch (e) {
   if (token === sequence.current) {
    setError(e.message);
   }
  } finally {
   if (token === sequence.current) {
    setBusy(false);
   }
  }
 }

 useEffect(() => {
  search();

  return () => {
   sequence.current++;
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);

 useEffect(() => {
  let active = true;

  setRecord(null);
  setDetailError('');
  setDetailBusy(!!recordId);

  if (recordId) {
   api(`/public/characters/${recordId}`)
       .then(result => {
        if (active) {
         setRecord(result.character);
        }
       })
       .catch(e => {
        if (active) {
         setDetailError(e.message);
        }
       })
       .finally(() => {
        if (active) {
         setDetailBusy(false);
        }
       });
  }

  return () => {
   active = false;
  };
 }, [recordId]);

 function openCharacter(id) {
  onOpen?.(String(id));
 }

 return (
     <section className="survival-card public-content public-character-directory">
      <div className="public-directory-heading">
       <div>
        <span className="badge">SURVIVOR ROSTER</span>
        <h2>공개 캐릭터 목록</h2>
       </div>

       {!recordId && (
           <span className="public-directory-count">
                        {rows.length}명 표시
                    </span>
       )}
      </div>

      {recordId ? (
          <div className="public-character-detail">
           <div className="public-character-detail-actions">
            <button type="button" onClick={onBack}>
             목록으로 돌아가기
            </button>
           </div>

           {detailBusy && <p role="status">캐릭터 정보를 불러오는 중…</p>}
           {detailError && <p role="alert">{detailError}</p>}

           {record && (
               <>
                <div className="public-character-detail-profile">
                 <CharacterAvatar character={record} large/>

                 <div className="public-character-detail-information">
                  <span className="badge">SURVIVOR PROFILE</span>
                  <h3>{record.name}</h3>
                  <CharacterInformation character={record}/>
                 </div>
                </div>

                {canReadDetails ? (
                    <div className="public-character-detail-content">
                     <PublicCharacterPanel key={record.id} targetId={record.id}/>
                    </div>
                ) : (
                    <p className="public-character-login-guide">
                     HP·혈량·AP·능력치 및 소지품 정보는 캐릭터가 연결된 러너로 로그인한 뒤 확인할 수 있습니다.
                    </p>
                )}
               </>
           )}
          </div>
      ) : (
          <>
           <form className="public-character-search" onSubmit={event => {
            event.preventDefault();
            search();
           }}>
            <label>
             캐릭터명 검색
             <input
                 type="search"
                 maxLength={100}
                 placeholder="캐릭터 이름을 입력하세요."
                 value={query}
                 disabled={busy}
                 onChange={event => setQuery(event.target.value)}
             />
            </label>

            <button type="submit" disabled={busy}>
             {busy ? '검색 중…' : '검색'}
            </button>
           </form>

           {error && <p role="alert">{error}</p>}
           {busy && <p role="status">캐릭터 목록 조회 중…</p>}

           {!busy && rows.length > 0 && (
               <ul className="public-character-list">
                {rows.map(character => (
                    <li key={character.id} className="public-character-item">
                     <CharacterAvatar character={character}/>

                     <div className="public-character-info">
                      <button
                          type="button"
                          className="public-character-name"
                          onClick={() => openCharacter(character.id)}
                      >
                       {character.name}
                      </button>

                      <CharacterInformation character={character}/>
                     </div>

                     <button
                         type="button"
                         className="public-character-detail-button"
                         onClick={() => openCharacter(character.id)}
                     >
                      상세보기
                     </button>
                    </li>
                ))}
               </ul>
           )}

           {!busy && !error && rows.length === 0 && (
               <p className="public-directory-empty">공개된 캐릭터가 없습니다.</p>
           )}

           {next && (
               <div className="public-directory-pagination">
                <button type="button" disabled={busy} onClick={() => search(next)}>
                 다음 캐릭터
                </button>
               </div>
           )}
          </>
      )}
     </section>
 );
}