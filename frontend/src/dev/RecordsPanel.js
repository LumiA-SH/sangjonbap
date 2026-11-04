import {useEffect, useRef, useState} from 'react';
import {api} from '../api/client';

const sections = [['action-logs', '내 행동 로그'], ['investigations', '내 조사 기록'],
  ['discoveries', '서버 최초 발견 기록'], ['clues', '공개된 단서']];

export default function RecordsPanel({admin = false, onDenied}) {
  const [kind, setKind] = useState('action-logs');
  const [records, setRecords] = useState([]);
  const [next, setNext] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(null);
  const path = admin ? '/admin/action-logs' : `/records/${kind}`;
  async function load(before = null) {
    const sequence = {};
    request.current = sequence;
    setBusy(true); setError(''); setRecords([]); setNext(null);
    try {
      const data = await api(path + (before ? `?before=${encodeURIComponent(before)}` : ''));
      if (sequence !== request.current) return;
      setRecords(data.records); setNext(data.nextBefore);
    } catch (e) {
      if (sequence !== request.current) return;
      setError(`${e.code || 'RECORDS_FAILED'}: ${e.message}`);
      if ([401, 403].includes(e.status)) onDenied?.(e.message);
    } finally { if (sequence === request.current) setBusy(false); }
  }
  useEffect(() => {
    load();
    return () => {request.current = null;};
    // Fetch on section change, not when the parent recreates its callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  return <section aria-label={admin ? '운영진 전체 행동 로그' : '기록·단서 아카이브'}>
    <h2>{admin ? '운영진 전체 행동 로그' : '기록·단서 아카이브'}</h2>
    {!admin && <nav className="actions">{sections.map(([value, label]) =>
      <button key={value} disabled={busy || kind === value} onClick={() => setKind(value)}>{label}</button>)}</nav>}
    <p>{admin ? '관리자 변경을 포함한 전체 행동 기록' : '본인 기록과 서버에 공개된 최초 발견·단서만 표시합니다.'} · 한 번에 30건</p>
    <button disabled={busy} onClick={() => load()}>기록 새로고침</button>
    {busy && <p role="status">불러오는 중…</p>}
    {error && <p role="alert">{error}</p>}
    {!busy && !error && records.length === 0 && <p>공개되거나 기록된 항목이 없습니다.</p>}
    <ul className="dev-list">{records.map(record => <li key={record.id} className="dev-row">
      <strong>{record.title || record.action_type || '최초 발견'}</strong> · ID {record.id}
      <p>{record.created_at || record.discovered_at || '시각 미기록'} · {record.character_name || '이름 미기록'} (ID {record.character_id || '-'})</p>
      {record.area_name && <p>지역: {record.area_name} · ID {record.area_id}</p>}
      {record.target_type && <p>대상: {record.target_type} {record.target_id}</p>}
      <p>{record.description || record.result_text || record.content}</p>
      {record.related_target && <p>관련 대상: {record.related_target}</p>}
      {record.detail && <details><summary>상세 JSON</summary><pre>{JSON.stringify(record.detail, null, 2)}</pre></details>}
    </li>)}</ul>
    {next && <button disabled={busy} onClick={() => load(next)}>이전 기록 30건</button>}
  </section>;
}
