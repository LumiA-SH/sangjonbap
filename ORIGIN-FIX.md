# 개발 로그인 Origin 수정

CRA react-dev-utils의 기본 package.json proxy는 Origin을 프록시 target으로 바꾼다.
localhost:3000에서 로그인해도 API가 받는 Origin은 http://127.0.0.1:4000이므로
FRONTEND_ORIGIN=http://localhost:3000과 불일치해 키 검사 전에 403이 발생한다.

package.json proxy 대신 frontend/src/setupProxy.js에서 /api 요청만 전달한다.
Host만 target에 맞추고 Origin은 그대로 보존한다. 서버의 정확한 Origin 비교,
개발 키 검증, 메모리 Bearer 세션, 사용자별 캐릭터 조회 구조는 유지한다.

## 실행

- 프론트와 서버를 모두 재시작한다. setupProxy 변경은 CRA 재시작이 필요하다.
- http://localhost:3000 으로 접속한다.
- server/.env: FRONTEND_ORIGIN=http://localhost:3000
- frontend/.env: REACT_APP_API_BASE=/api (미설정 시에도 /api가 기본값)
- DEV_LOGIN_KEY는 서버 .env에만 보관하고 로그인 화면에 입력한다.
- 서버의 127.0.0.1:4000은 프록시의 연결 대상이며 브라우저 출처가 아니다.
- 127.0.0.1:3000으로 접속하려면 FRONTEND_ORIGIN과 프론트 HOST를 그 주소에 맞추고 재시작한다.
  두 호스트는 서로 다른 출처이므로 자동으로 함께 허용하지 않는다.
- 프론트에서 절대 백엔드 URL로 직접 요청하는 CORS 방식은 이 구성의 대상이 아니다.

## 검증

npm.cmd test 로 기존 API 테스트와 실제 HTTP 프록시 통합 테스트를 실행한다.
허용 출처 로그인과 캐릭터 조회, 잘못된 키, 무인증 조회, 외부 출처,
다른 포트/호스트, null Origin, 전달 헤더 위조 차단을 검증한다.

server/src/db/pool.js의 로컬 개발용 rejectUnauthorized:false와 TODO는 그대로 보존했다.
이 임시 설정을 운영용 TLS 설정으로 간주하지 않는다.
