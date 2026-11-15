import {actionLabel,actionSummary} from './recordSummary';
import {useEffect, useRef, useState} from 'react';
import {api} from '../api/client';
import './RecordsPanel.css';

const sections = [
  {id: 'action-logs', title: '내 행동 로그', description: '캐릭터가 수행한 행동 기록', number: '01'},
  {id: 'investigations', title: '내 조사 기록', description: '지역을 탐색한 조사 기록', number: '02'},
  {id: 'discoveries', title: '서버 최초 발견', description: '서버에 최초로 발견된 정보', number: '03'},
  {id: 'clues', title: '공개된 단서', description: '공개된 단서와 발견 정보', number: '04'}
];

function recordDate(value) {
  if (!value) return '시각 미기록';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function recordTitle(record, kind) {
  if (record.title) return record.title;
  if (kind === 'discoveries') return '최초 발견 기록';
  if (kind === 'clues') return '공개 단서';
  return actionLabel(record);
}

function recordDescription(record) {
  return actionSummary(record);
}

function RecordDetail({record, kind}) {
  if (!record) {
    return (
        <div className="records-detail-empty">
          <strong>선택된 기록이 없습니다.</strong>
          <p>왼쪽 목록에서 확인할 기록을 선택해 주세요.</p>
        </div>
    );
  }

  const date = record.created_at || record.discovered_at;
  const title = recordTitle(record, kind);

  return (
      <>
        <div className="records-detail-heading">
          <span className="records-detail-type">{sections.find(item => item.id === kind)?.title}</span>
          <h3>{title}</h3>
          <p>RECORD NO. {record.id}</p>
        </div>

        <div className="records-detail-information">
          <div>
            <span>기록 시각</span>
            <strong>{recordDate(date)}</strong>
          </div>
          <div>
            <span>관련 캐릭터</span>
            <strong>{record.character_name || '이름 미기록'}</strong>
          </div>
          {record.area_name && (
              <div>
                <span>조사 지역</span>
                <strong>{record.area_name}</strong>
              </div>
          )}
          {record.category && (
              <div>
                <span>기록 분류</span>
                <strong>{record.category}</strong>
              </div>
          )}
          {record.target_type && (
              <div>
                <span>대상</span>
                <strong>{record.target_type} {record.target_id || ''}</strong>
              </div>
          )}
          {record.related_target && (
              <div>
                <span>관련 대상</span>
                <strong>{record.related_target}</strong>
              </div>
          )}
        </div>

        <div className="records-detail-content">
          <h4>기록 내용</h4>
          <div className="records-content-paper">
            {recordDescription(record)}
          </div>
        </div>

        {record.detail && (
            <details className="records-detail-json">
              <summary>상세 데이터 확인</summary>
              <pre>{JSON.stringify(record.detail, null, 2)}</pre>
            </details>
        )}

        <div className="records-detail-footer">
          <span>RECORD ARCHIVE</span>
          <span>#{record.id}</span>
        </div>
      </>
  );
}

export default function RecordsPanel({admin = false, onDenied, active = true}) {
  const [kind, setKind] = useState('action-logs');
  const [records, setRecords] = useState([]);
  const [next, setNext] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const request = useRef(null);
  const path = admin ? '/admin/action-logs' : `/records/${kind}`;
  const selectedSection = sections.find(item => item.id === kind);
  const selectedRecord = records.find(record => String(record.id) === selectedId) || records[0] || null;

  async function load(before = null) {
    const sequence = {};
    request.current = sequence;
    setBusy(true);
    setError('');
    setRecords([]);
    setNext(null);

    try {
      const data = await api(path + (before ? `?before=${encodeURIComponent(before)}` : ''));
      if (sequence !== request.current) return;

      setRecords(data.records);
      setNext(data.nextBefore);
    } catch (e) {
      if (sequence !== request.current) return;

      setError(`${e.code || 'RECORDS_FAILED'}: ${e.message}`);
      if ([401, 403].includes(e.status)) onDenied?.(e.message);
    } finally {
      if (sequence === request.current) setBusy(false);
    }
  }

  useEffect(() => {
    if(active)load();

    return () => {
      request.current = null;
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path,active]);

  function changeSection(value) {
    if (busy || kind === value) return;
    setSelectedId(null);
    setKind(value);
  }

  if (admin) {
    return (
        <section className="admin-operations-page" aria-label="운영진 전체 행동 로그">
          <h2>운영진 전체 행동 로그</h2>
          <p>관리자 변경을 포함한 전체 행동 기록 · 한 번에 30건</p>
          <button disabled={busy} onClick={() => load()}>기록 새로고침</button>
          {busy && <p role="status">불러오는 중…</p>}
          {error && <p role="alert">{error}</p>}
          {!busy && !error && records.length === 0 && <p>공개되거나 기록된 항목이 없습니다.</p>}
          <div className="admin-log-table-wrap">
            <table className="admin-log-table">
              <thead>
              <tr><th>시각</th><th>캐릭터</th><th>구분</th><th>결과</th></tr>
              </thead>
              <tbody>
              {records.map(record => (
                  <tr key={record.id}>
                    <td>{record.created_at || '시각 미기록'}</td>
                    <td>{record.character_name || '이름 미기록'}<small>ID {record.character_id || '-'}</small></td>
                    <td>{actionLabel(record)}<small>ID {record.id}</small></td>
                    <td>
                      {actionSummary(record)}
                      {record.target_type && <p>대상: {record.target_type} {record.target_id}</p>}
                      {record.detail && <details><summary>상세 JSON</summary><pre>{JSON.stringify(record.detail, null, 2)}</pre></details>}
                    </td>
                  </tr>
              ))}
              </tbody>
            </table>
          </div>
          {next && <button disabled={busy} onClick={() => load(next)}>이전 기록 30건</button>}
        </section>
    );
  }

  return (
      <section className="survival-records" aria-labelledby="records-title">
        <header className="records-header">
          <div>
            <h2 id="records-title">기록 아카이브</h2>
            <p>생존 과정에서 남겨진 행동과 조사, 발견한 단서를 확인합니다.</p>
          </div>
          <button type="button" disabled={busy} onClick={() => load()}>기록 새로고침</button>
        </header>

        <nav className="records-tabs" aria-label="기록 종류">
          {sections.map(section => (
              <button key={section.id} type="button" className={kind === section.id ? 'is-active' : ''} aria-current={kind === section.id ? 'page' : undefined} disabled={busy || kind === section.id} onClick={() => changeSection(section.id)}>
                <span>{section.number}</span>
                <strong>{section.title}</strong>
              </button>
          ))}
        </nav>

        <div className="records-summary">
          <div>
            <span>ARCHIVE CATEGORY</span>
            <h3>{selectedSection.title}</h3>
            <p>{selectedSection.description}</p>
          </div>
          <div className="records-summary-count">
            <small>현재 페이지 기록</small>
            <strong>{records.length}<span>건</span></strong>
          </div>
        </div>

        {error && <p className="records-notice" role="alert">{error}</p>}

        <div className="records-workspace">
          <div className="records-browser">
            <div className="records-browser-heading">
              <h3>기록 목록</h3>
              <span>최신 기록순</span>
            </div>

            {busy ? (
                <div className="records-list-empty" role="status">기록을 불러오는 중입니다...</div>
            ) : records.length === 0 ? (
                <div className="records-list-empty">
                  {error ? '기록을 불러오지 못했습니다.' : '현재 기록된 항목이 없습니다.'}
                </div>
            ) : (
                <div className="records-list">
                  {records.map(record => {
                    const selected = String(selectedRecord?.id) === String(record.id);

                    return (
                        <button key={record.id} type="button" className={`records-list-item${selected ? ' is-selected' : ''}`} aria-pressed={selected} onClick={() => setSelectedId(String(record.id))}>
                          <div className="records-list-item-heading">
                            <strong>{recordTitle(record, kind)}</strong>
                            <span>#{record.id}</span>
                          </div>
                          <p>{recordDescription(record)}</p>
                          <div className="records-list-item-meta">
                            <span>{recordDate(record.created_at || record.discovered_at)}</span>
                            {record.area_name && <span>{record.area_name}</span>}
                          </div>
                        </button>
                    );
                  })}
                </div>
            )}

            {next && (
                <button type="button" className="records-more" disabled={busy} onClick={() => {setSelectedId(null); load(next);}}>
                  이전 기록 30건 보기
                </button>
            )}
          </div>

          <aside className="records-detail" aria-label="선택한 기록 상세">
            <div className="records-detail-top">
              <h3>기록 상세</h3>
              <span>ARCHIVE DETAIL</span>
            </div>
            {busy ? (
                <div className="records-detail-empty">기록을 불러오는 중입니다...</div>
            ) : (
                <RecordDetail record={selectedRecord} kind={kind}/>
            )}
          </aside>
        </div>

        <p className="records-footer-note">본인 행동 및 조사 기록과 서버에 공개된 최초 발견·단서만 확인할 수 있습니다. 기록은 한 번에 최대 30건씩 조회됩니다.</p>
      </section>
  );
}