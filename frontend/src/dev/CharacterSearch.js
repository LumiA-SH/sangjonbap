import {useRef, useState} from 'react';
import {api} from '../api/client';

export default function CharacterSearch({busy, onSelect}) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const searching = useRef(false);
  async function search(event) {
    event.preventDefault();
    if (busy || searching.current || !query.trim()) return;
    searching.current = true; setPending(true); setRows(null); setError('');
    try { setRows((await api(`/characters/search?q=${encodeURIComponent(query.trim())}`)).characters); }
    catch (e) { setError(`${e.code || 'SEARCH_FAILED'}: ${e.message}`); }
    finally { searching.current = false; setPending(false); }
  }
  return <div>
    <form onSubmit={search}>
      <label htmlFor="character-search">치료·부활 대상 이름 검색</label>
      <input id="character-search" value={query} maxLength={40} disabled={busy || pending}
        onChange={event => {setQuery(event.target.value); setRows(null); setError('');}}/>
      <button disabled={busy || pending || !query.trim()}>이름 검색</button>
    </form>
    <p>활성 계정에 연결된 활성 캐릭터, 최대 30건. 동명이인은 ID로 구분하세요.</p>
    {error && <p role="alert">검색 실패: {error}</p>}
    {rows?.length === 0 && <p>검색 결과가 없습니다.</p>}
    <ul>{rows?.map(row => <li key={row.id}>{row.name} · ID {row.id}
      <button disabled={busy || pending} onClick={() => onSelect(String(row.id))}>ID {row.id} 선택</button>
    </li>)}</ul>
  </div>;
}
