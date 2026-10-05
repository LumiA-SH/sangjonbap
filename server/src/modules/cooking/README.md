# cooking

확장 예정 모듈입니다. 아직 라우트를 등록하지 않았습니다.

- routes.js: 인증 후 입력 검증과 공통 응답
- service.js: 게임 규칙, 권한, 트랜잭션 경계
- repository.js: 파라미터 SQL 및 사용자 소유권 조건
- app.js에서 /api/cooking 라우트를 명시적으로 등록
- AP/재화/재료 변경은 하나의 트랜잭션과 행 잠금으로 처리
- 중복 액션은 기존 action_log.request_key 제약과 함께 처리
