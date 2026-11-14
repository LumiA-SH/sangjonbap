import {useRef, useState} from 'react';
import {api} from '../api/client';

export default function RolePanel({onDenied}) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [next, setNext] = useState(null);
  const working = useRef(false);

  function error(e) {
    setMessage(`${e.code || 'REQUEST_FAILED'}: ${e.message}`);
    if ([401, 403].includes(e.status)) onDenied(e.message);
  }

  async function load(after = null) {
    const data = await api(`/admin/users?q=${encodeURIComponent(query)}${after ? `&after=${after}` : ''}`);

    setRows(data.records);
    setNext(data.nextAfter);
  }

  async function search(event, after = null) {
    event?.preventDefault();
    if (working.current) return;

    working.current = true;
    setBusy(true);
    setMessage('');

    try {
      await load(after);
    } catch (e) {
      setRows([]);
      error(e);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  async function change(row) {
    if (working.current) return;

    const role = row.role === 'ADMIN' ? 'USER' : 'ADMIN';
    const confirmMessage = `계정 ID ${row.id} (${row.character_name || '캐릭터 없음'}) 역할을 ${row.role} → ${role}로 변경할까요?`;

    if (!window.confirm(confirmMessage)) return;

    working.current = true;
    setBusy(true);
    setMessage('');

    try {
      await api(`/admin/users/${row.id}/role`, {
        method: 'PATCH',
        body: {
          role,
          requestKey: crypto.randomUUID()
        }
      });

      await load();
      setMessage('권한 변경 및 최신 목록 조회 완료');
    } catch (e) {
      error(e);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  async function testAccess(row) {
    if (working.current) return;

    const enabled = !row.game_test_enabled;
    const confirmMessage = `계정 ID ${row.id} (${row.character_name || '캐릭터 없음'}) 테스트 참여를 ${enabled ? '허용' : '해제'}합니까? 관리자 권한은 변경되지 않습니다.`;

    if (!window.confirm(confirmMessage)) return;

    working.current = true;
    setBusy(true);
    setMessage('');

    try {
      await api('/admin/users/' + row.id + '/test-access', {
        method: 'PATCH',
        body: {
          enabled,
          expectedEnabled: row.game_test_enabled === true,
          requestKey: crypto.randomUUID()
        }
      });

      await load();
      setMessage('테스트 참여 설정 저장 완료');
    } catch (e) {
      error(e);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  return (
      <section aria-label="관리자 권한 관리">
        <h2>계정 역할 관리</h2>
        <p>관리자는 게임 테스트에 참여할 수 있습니다. 일반 러너는 테스트 참여 허용이 필요하며 관리자 권한과는 별개입니다.</p>
        <p>본인 권한 회수 및 마지막 활성 관리자 회수는 서버에서 거부합니다.</p>

        <form onSubmit={search}>
          <label>
            캐릭터 이름 또는 계정 ID
            <input value={query} maxLength={100} disabled={busy} onChange={e => setQuery(e.target.value)}/>
          </label>
          <button disabled={busy}>사용자 검색</button>
        </form>

        <p role="status">{busy ? '처리 중…' : message}</p>

        <ul>
          {rows.map(row => (
              <li key={row.id}>
                계정 ID {row.id} · {row.character_name || '캐릭터 없음'} · {row.role} · {row.is_active ? '활성' : '비활성'}
                <button disabled={busy} onClick={() => change(row)}>{row.role === 'ADMIN' ? '권한 회수' : '관리자 지정'}</button>
                {' · 테스트 '}
                {row.role === 'ADMIN' ? '관리자 허용' : row.game_test_enabled ? '허용' : '미지정'}

                {row.role !== 'ADMIN' && (
                    <button disabled={busy || !row.is_active} onClick={() => testAccess(row)}>{row.game_test_enabled ? '테스트 참여 해제' : '테스트 참여 허용'}</button>
                )}
              </li>
          ))}
        </ul>

        {next && <button disabled={busy} onClick={e => search(e, next)}>다음 100건</button>}
      </section>
  );
}