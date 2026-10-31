# 관리자 기능 1·2차

2026-10-29 마물/이능 설정 및 승인 캐릭터 등록 확장은 [PVE 인수인계](../../../../PVE-2026-10-29.md)를 참고한다.
기존 ADMIN 검증과 감사로그를 사용하며 실제 계정의 역할을 자동 변경하지 않는다.

음식·레시피·가챠 관리, 관리자 지정/회수 및 CLI의 상세 인수인계는 [PHASE-2.md](./PHASE-2.md)를 참고한다.

## 현재 인증과 운영 HOLD

AUTH_USER.role의 기존 USER/ADMIN CHECK를 재사용한다. 권한용 스키마 변경은 없다.
Mastodon OAuth는 아직 미구현이다. 현재 세션은 DEV 로그인에서 발급하며 기존 config는 production 실행 자체를 거부한다.
추가로 DEV provider.authenticate에서도 production 및 비DEV provider 인증을 거부한다.
관리 API 역시 production/비DEV provider에서 ADMIN_AUTH_HOLD(503)로 닫힌다. 운영 인증 우회를 만들지 않았다.
관리자 화면은 운영 관리 기능의 기본 UI이지만 **운영 배포 가능한 인증이 완성된 상태가 아니다**.
실제 ADMIN 계정이 없다면 UI 접근은 HOLD이며 테스트 계정으로 자동 검증만 수행한다.

## 권한 부여·회수

2차에서 고객이 명시적으로 승인한 최초 지정 CLI와 ADMIN 전용 지정/회수 API를 구현했다.
실제 계정 역할은 변경하지 않았다. DEV 로그인 키를 안다는 이유로 관리자가 되지 않는다.
권한 원본은 AUTH_USER.role/is_active이며, 자동 승격·자동 관리자 생성은 없다.
운영 OAuth가 없으므로 실제 계정 최초 지정과 운영 화면 접근은 계속 HOLD다. 아래 CLI는 구현과 격리 테스트만 수행했다.
기술적으로 역할이 회수되면 sessions.require가 매 요청 getUser로 다시 읽으므로 기존 토큰도 다음 요청부터 403이다.
쓰기 중 권한 변경은 아래 role 행 잠금으로 직렬화된다. 진행 중 거래는 먼저 잡은 잠금 순서대로 완료된다.

## API / 미들웨어

모든 /api/admin 경로: 환경 gate → sessions.require(401) → shared/admin.js requireAdmin(403).
프론트의 숨김 여부와 무관하다. 매 요청 DB 사용자 활성/역할을 읽는다.

- GET /api/admin/access: role=ADMIN, authentication=DEV, productionReady=false.
- GET /api/admin/items?after=ID: ID 커서 목록 100건, nextAfter.
- GET /api/admin/items/:id: 상세.
- POST /api/admin/items: 등록.
- PATCH /api/admin/items/:id: 일부 수정.
- products에도 동일한 목록/상세/등록/수정 API.
- 삭제, 역할 변경, SYSTEM_CONFIG 변경 API 없음.

쓰기 body에는 requestKey UUID가 필수다. 중복은 409 DUPLICATE_REQUEST.
입력 허용 필드만 SQL 열 이름으로 사용하고 값은 파라미터로 바인딩한다.
아이템: name(공백뿐인 값 금지, DB 100자), category(MATERIAL/CONSUMABLE/FOOD/ETC), description(text/null), transferable/is_active(boolean).
기타 필드는 기존 DB 기본값을 사용하고 수정 시 보존한다.
image_url의 허용 형식, effect_type/effect_value 및 usable/use_target 조합의 운영 정책은 미확정이라 편집 HOLD.
읽기 상세에는 기존 실제 컬럼을 반환한다. 설명은 React 텍스트로 표시하며 HTML 실행 안 함.
상품: item_id(bigint 문자열), price(비음수 int4), purchase_limit(NULL 또는 양수), stock_limit(NULL 또는 비음수), is_active, sort_order(int4).
NULL 한도는 무제한. 기존 상품 기본값과 CHECK를 따른다. 새로운 게임 수치나 권한 정책을 만들지 않는다.

## 거래와 참조 무결성

saveAdminRecord: BEGIN → 상품 수정이면 SHOP_PRODUCT FOR UPDATE → 관리자 AUTH_USER FOR SHARE/역할 재검증
→ requestKey 검사 → 아이템 FOR UPDATE → INSERT/UPDATE → shared writeActionLog → COMMIT.
오류는 전체 ROLLBACK, finally release. 아이템 수정은 관리자 역할 확인 후 해당 아이템만 잠근다.
구매는 상품 → 사용자/캐릭터 → 아이템 순서이므로 같은 상품을 수정할 때 잠금 순서를 거스르지 않는다.
상품을 잠근 뒤 SHOP_PURCHASE SUM을 조회하므로 구매 동시 실행과 재고 검사가 직렬화된다.
stock_limit을 이미 판매한 수량보다 낮게 설정하면 STOCK_LIMIT_CONFLICT.
purchase_limit을 기존 구매량보다 낮게 설정하더라도 이력은 변경하지 않으며 기존 구매 API의 max(0,한도-누적량)에 따라 잔여 0이다.
상품 가격 변경은 기존 SHOP_PURCHASE.unit_price/total_price 스냅샷을 변경하지 않는다.
판매된 상품의 item_id 교체는 PRODUCT_ITEM_CHANGE_HOLD: 기존 이력에 item snapshot이 없어 의미 보존을 위해 새 상품 등록을 사용한다.
삭제/참조 재작성은 없으며 ITEM을 참조하는 inventory/storage/food_config/recipe/recipe_ingredient/gacha_reward/shop_product/
investigation_reward/monster_drop의 기존 행은 건드리지 않는다. 비활성화도 수량/이력을 삭제하지 않는다.

ACTION_LOG: admin_user_id, category=ADMIN, ITEM_CREATE/ITEM_UPDATE/SHOP_PRODUCT_CREATE/SHOP_PRODUCT_UPDATE,
target_type/target_id, detail.before/after, request_key를 같은 트랜잭션으로 기록한다.
기존 DEV 행동 로그는 캐릭터 행위자만 조회하므로 관리자 로그는 그 목록에 나오지 않는다. 관리자 로그 전용 UI는 후속 범위다.

## 프론트

로그인 후 '관리자 영역' 진입 → /admin/access 권한 확인 → AdminPanel.
DEV 게임 패널과 화면을 분리하며 서버 권한 오류가 나면 편집 영역과 조회 데이터를 제거한다.
아이템/상품 목록, 상세 조회 후 편집, 등록, NULL 무제한 체크박스, 저장/검증/권한 오류 제공.
신규 상품의 판매 아이템은 관리자 아이템 목록에서 확인한 ID를 입력한다.
CSS grid는 600px 이하에서 1열. 외부 라이브러리/라우터 추가 없음.

## 운영 절차와 테스트

1. OAuth 구현 전 운영 배포 및 실제 계정 최초 지정을 진행하지 않는다.
2. 승인된 ADMIN 계정이 마련되면 서버 인증으로 로그인하고 관리자 영역에서 권한 확인.
3. 아이템 등록/조회 후 상품 등록. 두 한도의 NULL 여부를 확인하고 저장한다.
4. 기존 상품 수정 시 판매 이력/가격 스냅샷/전체 한도 검사를 유지한다. 제거 대신 비활성화한다.
5. 관리자 감사는 ACTION_LOG.admin_user_id와 before/after로 확인한다.

RUN_ADMIN_DB_TESTS=1로 server/test/admin*.test.js를 실행한다.
테스트는 별도 임시 ADMIN/USER 계정, DEV admin test 캐릭터 및 아이템/상품만 생성하고 finally에서 ID 기준 정리한다.
임시 ADMIN의 역할 변경 테스트는 실제 계정을 수정하지 않는다. 강제 종료 시 fixture 정리가 누락될 수 있고 identity는 증가한다.
서버 테스트는 게스트/USER/ADMIN, 역할 회수, 운영 DEV 차단, 스키마 검증, 등록/수정/로그 rollback,
재고 한도 충돌/개인 이력 보존/구매 동시성을 검증한다. 프론트는 권한 오류·등록·NULL·저장 오류를 검증한다.
