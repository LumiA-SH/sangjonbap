# 생존밥 초기 개발 프로젝트

React CRA + JavaScript → Express JavaScript API → Supabase PostgreSQL.
TypeScript나 Vite를 사용하지 않습니다. `react-scripts 5.0.1` 기반 CRA 프로젝트입니다.

## 빠른 실행 — Windows 11 / PowerShell

Node.js 22 및 npm이 필요합니다. ZIP을 풀고 `package.json`이 있는 `sangjonbap` 폴더를 IntelliJ에서 Open 하세요.
두 개의 IntelliJ Terminal 탭을 열어 실행합니다. PowerShell 실행 정책 문제를 피하도록 `npm.cmd`를 사용합니다.

```powershell
# 프로젝트 루트에서 한 번 실행
Copy-Item server/.env.example server/.env
Copy-Item frontend/.env.example frontend/.env
npm.cmd ci
```

`server/.env`의 `DEV_LOGIN_KEY=`에 본인만 사용할 16자 이상의 임의 문자열을 입력하고 저장하세요.
실제 비밀값은 ZIP에 없습니다. 이 키는 개발 화면에 직접 입력하는 임시 로그인 비밀번호이며 프론트 환경변수에 넣지 않습니다.

```powershell
# 터미널 1 — 프로젝트 루트
npm.cmd run dev:server
```

```powershell
# 터미널 2 — 같은 프로젝트 루트
npm.cmd run dev:frontend
```

브라우저에서 http://localhost:3000 을 열고 개발 로그인 키를 입력하세요.
기본 `DATA_MODE=memory`에서는 예제 계정과 캐릭터를 사용합니다. 조회·이름 저장·로그아웃을 바로 확인할 수 있습니다.
**메모리 데이터와 로그인 세션은 서버 재시작 시 없어집니다.** 화면 새로고침도 다시 로그인해야 합니다.
종료는 각 터미널에서 Ctrl+C입니다. `.env` 변경 후 서버를 재시작하세요.

## 실제 Sangjonbap DB 연결

대상: `Sangjonbap`, ref `grkohfxvafbquhmgnvwj`.
2026-10-05 읽기 전용 조회로 public 테이블 28개, 코어 컬럼·제약·identity PK를 확인해 코드를 맞췄습니다.
이 ZIP을 만들면서 원격 데이터, 테이블, RLS, 정책은 수정하지 않았습니다.

1. [Supabase 프로젝트](https://supabase.com/dashboard/project/grkohfxvafbquhmgnvwj)에서 **Connect → Session pooler**의 연결 문자열을 복사합니다. Windows IPv4 환경에서 사용하기 쉽습니다. 호스트는 직접 추측하지 말고 대시보드에서 복사하세요.
2. `server/.env`에 `DATA_MODE=supabase`, `DATABASE_URL=복사한 연결 문자열`을 설정합니다. DB 비밀번호의 특수문자는 URL 인코딩합니다. API anon/service_role 키가 아니라 **PostgreSQL 연결 문자열**을 사용하는 구현입니다.
3. TLS 인증서 검증은 켜져 있습니다. 인증서 오류가 있으면 대시보드의 신뢰할 수 있는 CA 인증서를 내려받아 `DATABASE_CA_PATH=인증서경로`에 설정하세요. 검증을 끄지 마세요. URI의 SSL 옵션은 코드에서 제거하고 검증 설정을 명시합니다.
4. DB가 비어 있으면 `supabase/dev-account.sql`을 검토한 뒤 Supabase SQL Editor에서 **한 번** 실행하세요. 기존 테이블에 개발 캐릭터와 USER 계정 한 쌍을 트랜잭션으로 만듭니다. 자동 실행되지 않으며 매번 새 계정이 만들어집니다. 이미 연결된 계정이 있으면 SQL을 실행할 필요가 없습니다.
5. 반환된 `dev_auth_user_id`를 `DEV_AUTH_USER_ID`로 설정합니다. 브라우저에서 사용자 ID를 지정할 수 없습니다.
6. 아래 연결 점검 후 서버를 시작합니다.

```powershell
npm.cmd run db:check
npm.cmd run dev:server
```

`db:check`는 실제 연결과 필수 테이블·컬럼 접근을 확인하며 데이터를 쓰지 않습니다.
원격 DB의 메타데이터 조회는 검증했지만, 사용자 비밀번호가 없으므로 이 ZIP의 DATABASE_URL을 통한 실제 연결·쓰기 테스트는 실행하지 않았습니다.

서버의 DB 계정은 서버에만 보관합니다. 대시보드 postgres 계정은 개발 연결용으로 강한 권한을 갖고 RLS를 우회할 수 있으므로 API가 매 요청 활성 사용자와 캐릭터 소유권을 검증합니다.
프론트에는 Supabase SDK, DB 키, DB 직접 요청이 없습니다. 기존 RLS를 끄거나 anon 정책을 열 필요가 없습니다.
배포 전에는 최소권한 DB 계정과 실제 인증 설계를 별도로 적용하세요.

## 포함 API

| 메서드 | 경로 | 동작 |
|---|---|---|
| GET | `/api/health` | 프로세스 상태와 데이터 모드 (DB 상태 점검은 db:check) |
| POST | `/api/auth/dev/login` | `{ "key": "로컬 개발키" }` → 세션 token, 사용자 |
| GET | `/api/auth/me` | 현재 사용자 |
| POST | `/api/auth/logout` | 현재 세션 즉시 폐기 |
| GET | `/api/characters/me` | DB의 auth_user.character_id로 내 캐릭터 조회 |
| PATCH | `/api/characters/me/profile` | `{ "name": "이름" }`, 1~40자 |

인증 요청은 `Authorization: Bearer <token>` 헤더를 사용합니다. 세션 유효기간은 1시간입니다.
이름 외의 HP/AP/재화/소유자 필드는 PATCH에서 거부합니다. 게임 상태 변경은 이후 개별 액션 API의 서버 규칙으로 구현합니다.
캐릭터 생성·삭제·전투·인벤토리·Mastodon OAuth는 이번 뼈대에 구현하지 않았습니다.

성공: `{ "ok": true, "data": {...}, "requestId": "..." }`

실패: `{ "ok": false, "error": { "code": "...", "message": "..." }, "requestId": "..." }`

인증 실패 401, 비활성 계정/출처 거부 403, 없는 캐릭터 404, 잘못된 입력 400, 로그인 속도 제한 429를 구분합니다.
내부 SQL·비밀번호·원시 오류는 응답에 노출하지 않습니다. bigint ID는 문자열로 유지합니다.

## 구조와 확장

```text
frontend/
  public/index.html
  src/App.js                 개발 로그인·캐릭터 확인 화면
  src/api/client.js          API 호출과 메모리 토큰
  src/features/             inventory/investigation/battle/cooking/shop/admin/mastodon
server/
  src/app.js                라우트·공통 미들웨어 조립
  src/config/env.js         설정 검증, dev 운영 차단
  src/db/                   Supabase PostgreSQL 풀 / 메모리 저장소
  src/modules/auth/         provider, 세션, 인증 라우트
  src/modules/character/    캐릭터 라우트·DB repository
  src/modules/              이후 게임 모듈별 확장 위치
  src/shared/http.js        공통 응답·오류
  scripts/check-db.js        읽기 전용 연결 확인
  test/api.test.js           API 및 인증 회귀 테스트
supabase/dev-account.sql    선택 실행 개발 계정 SQL
```

작은 코어는 route → repository이며, 게임 규칙이 들어갈 모듈은 route → service → repository로 확장합니다.
AP 차감·재료 소모·보상은 한 트랜잭션 안에서 행 잠금과 조건 검사로 처리하고 기존 `action_log.request_key`로 중복 요청을 제어하세요.
현재 이름 수정은 활성 사용자와 캐릭터 행을 잠근 다음 저장합니다.

Mastodon이 준비되면 `modules/auth/providers/`에 OAuth provider를 추가해 검증된 외부 계정을 기존 `auth_user`에 매핑하고 공통 세션을 발급합니다.
게임 API는 계속 `req.auth.user`만 받습니다. `AUTH_PROVIDER=mastodon`은 아직 구현되지 않아 즉시 실패합니다.
서로 다른 인스턴스의 계정 ID 충돌을 고려해 현재 mastodon_account_id 단독 UNIQUE 제약도 검토해야 합니다.

## 검증 및 IntelliJ

```powershell
npm.cmd test
npm.cmd run build
```

서버 테스트는 메모리 저장소로 인증, 만료/폐기, 권한, 입력 제한, 오류 응답을 검사하고 가짜 DB 연결로 커밋·롤백을 검사합니다.
CRA 빌드 결과는 `frontend/build`입니다. 빌드는 배포 승인이나 운영 준비 완료를 뜻하지 않습니다.
IntelliJ Run Configuration은 npm 유형으로 루트 package.json의 `dev:server`, `dev:frontend`를 각각 지정하거나 터미널을 그대로 사용하세요.

개발 전용: API는 loopback 주소만 허용하며 `NODE_ENV=production`이면 시작하지 않습니다. 세션은 서버 메모리, 프론트 토큰은 브라우저 메모리에만 있습니다.
CRA 프록시가 `/api`를 `127.0.0.1:4000`으로 전달합니다. 포트 변경 시 frontend/package.json의 proxy도 맞추세요.
프론트를 다른 origin으로 열면 `FRONTEND_ORIGIN`도 정확히 맞춰야 합니다. 직접 교차 출처 접속은 구현하지 않고 CRA 프록시를 사용합니다.

CRA는 유지보수 종료 도구이지만 요청한 구조를 유지했습니다. 오래된 빌드 의존성 경고가 있을 수 있으며 임의의 `npm audit fix --force`는 CRA를 깨뜨릴 수 있습니다.
빌드 도구 마이그레이션은 이 프로젝트 범위에 포함하지 않았습니다.

참고: [CRA 실행 문서](https://create-react-app.dev/docs/getting-started/), [Supabase PostgreSQL 연결](https://supabase.com/docs/guides/database/connecting-to-postgres), [node-postgres TLS](https://node-postgres.com/features/ssl).
