# 검증 기록

검증일: 2026-10-05

- Node.js 22.21.0 / npm 10.9.4 / Windows PowerShell
- npm 의존성 설치 및 package-lock.json 생성 완료
- `npm.cmd test`: 8개 통과, 0개 실패
- `CI=true npm.cmd run build`: CRA 최적화 빌드 성공
- Supabase MCP 읽기 전용 쿼리: public 테이블 28개 및 auth_user/game_character 컬럼·제약·identity PK 확인
- 비밀 환경변수 파일 및 node_modules, 빌드 폴더는 배포 ZIP에서 제외

미검증 범위: 사용자 DB 비밀번호를 사용한 pg 연결과 실제 DB 쓰기, 브라우저 수동 UI 확인, Mastodon OAuth, 미구현 게임 모듈.
원격 DB에는 변경을 적용하지 않았습니다. 실제 DB 연결은 README에 따라 로컬 .env를 설정한 후 `npm.cmd run db:check`로 확인하세요.
