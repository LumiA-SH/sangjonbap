export default function ActionLogPanel({logs, error, busy, run, refresh}) {
  return <section aria-labelledby="logs-title">
    <span className="badge">ACTION LOG</span><h2 id="logs-title">최근 행동 로그</h2>
    <p>현재 개발 계정 캐릭터가 남긴 최근 30건 · 최신순</p>
    <button disabled={busy} onClick={() => run(refresh)}>로그 새로고침</button>
    {error && <p role="alert">로그 조회 실패: {error} · 아래는 이전 조회 결과일 수 있습니다.</p>}
    {!error && !logs.length && <p>기록된 로그가 없습니다.</p>}
    <div className="log-scroll"><ul className="dev-list">{logs.map(log => <li className="dev-row" key={log.id}>
      <strong>{log.action_type}</strong> · <time dateTime={log.created_at}>{log.created_at}</time>
      <p>캐릭터 {log.character_name || '이름 없음'} ({log.character_id}) · 대상 {log.target_type || '-'} {log.target_id || ''}</p>
      <p>{log.description}</p>
      <details><summary>detail JSON · 로그 {log.id}</summary><pre>{JSON.stringify(log.detail, null, 2)}</pre></details>
    </li>)}</ul></div>
  </section>;
}
