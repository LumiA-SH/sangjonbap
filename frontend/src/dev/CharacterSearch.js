import {useRef, useState} from 'react';
import {api} from '../api/client';

export default function CharacterSearch({
                                          busy,
                                          onSelect,
                                          inputId = 'character-search',
                                          label = '치료·부활 대상 이름 검색',
                                          action = null,
                                          collapseOnSelect = false,
                                          onQueryChange = () => {}
                                        }) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const searching = useRef(false);

  async function search(event) {
    event.preventDefault();

    if (busy || searching.current || !query.trim()) return;

    searching.current = true;
    setPending(true);
    setRows(null);
    setError('');

    try {
      const result = await api(
          `/characters/search?q=${encodeURIComponent(query.trim())}`
      );

      setRows(result.characters);
    } catch (e) {
      setError(`${e.code || 'SEARCH_FAILED'}: ${e.message}`);
    } finally {
      searching.current = false;
      setPending(false);
    }
  }

  function changeQuery(value) {
    setQuery(value);
    setRows(null);
    setError('');
    onQueryChange(value);
  }

  function selectCharacter(row) {
    onSelect(String(row.id), row);

    if (collapseOnSelect) {
      setRows(null);
    }
  }

  return (
      <div className="survival-character-search">
        <form onSubmit={search}>
          <label htmlFor={inputId}>{label}</label>

          <input id={inputId} value={query} maxLength={40} disabled={busy || pending} onChange={event => changeQuery(event.target.value)}/>

          <button type="submit" disabled={busy || pending || !query.trim()}>
            이름 검색
          </button>

          {action}
        </form>

        <p>활성 계정에 연결된 활성 캐릭터, 최대 30건. 동명이인은 ID로 구분하세요.</p>

        {error && <p role="alert">검색 실패: {error}</p>}

        {rows?.length === 0 && (
            <p>검색 결과가 없습니다.</p>
        )}

        {rows && rows.length > 0 && (
            <ul>
              {rows.map(row => (
                  <li key={row.id}>
                    <span>{row.name} · ID {row.id}</span>

                    <button type="button" disabled={busy || pending} onClick={() => selectCharacter(row)}>
                      ID {row.id} 선택
                    </button>
                  </li>
              ))}
            </ul>
        )}
      </div>
  );
}
