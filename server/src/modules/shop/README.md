# 상점 구매 API / DEV 콘솔

## 확정 규칙과 HOLD

SHOP_PRODUCT.purchase_limit은 **캐릭터별 상품별 전체 운영 기간 누적 수량 한도**로 재사용한다.
stock_limit은 **상품별 서버 전체 누적 판매 수량 한도**다. 두 값은 독립적이며 각각 NULL이면 무제한이다.
stock_limit=0은 품절이며 기존 purchase_limit의 양수 CHECK는 유지한다.
잔여 수량 = max(0, 한도 - SHOP_PURCHASE.quantity 합계). 인벤토리 소비/창고 이동/날짜 변경은 구매 한도를 복구하지 않는다.
동일 아이템이라도 서로 다른 상품 ID는 별도 한도다. 재입고를 원하면 총 한도를 늘리는 방식이며 별도 일일 초기화는 없다.

DEAD 구매 금지. NEAR_DEATH의 상점 정책은 기존 코드/문서에 근거가 없어 `409 SHOP_POLICY_HOLD`로 실행을 보류한다.
이는 영구적인 게임 금지 규칙이 아니라 정책 확정 전 HOLD다. 목록 조회는 가능하다.
일반 구매는 AP를 소비하지 않는다. 가격은 상품 price이며 요청에서 가격/사용자/아이템을 지정할 수 없다.

## migration

`supabase/migrations/20261009051552_shop_purchase_limits.sql`

- SHOP_PRODUCT.stock_limit nullable integer, 비음수 CHECK.
- SHOP_PURCHASE: product_id, character_id, quantity, unit_price, total_price, request_key, created_at.
- 가격은 구매 당시 snapshot. 수량 양수, 금액 일치 CHECK, request_key UNIQUE.
- 상품/캐릭터 합계용 인덱스 및 캐릭터 FK 인덱스.
- SHOP_PURCHASE RLS 활성화, anon/authenticated 권한 없음. 서버 PostgreSQL 연결만 사용한다.
- 기존 상품/캐릭터/재화/인벤토리를 수정하지 않았다. 확인 시 기존 상품은 0건, 구매 API도 없어서 이전 구매 이력 이관은 없다.
- Supabase CLI로 로컬 migration을 생성하고 원격 apply_migration 후 적용 버전에 파일명을 맞췄다.
  기존처럼 과거 원격 migration 전체가 로컬에 없으므로 무조건 db push/reset하지 않는다.

## API

기존 Bearer 인증과 `{ok,data,requestId}` envelope를 사용한다.

GET /api/shop/products → data.products:
- id, item_id, name, description, price, purchase_limit, stock_limit
- personalRemaining, globalRemaining (무제한은 null)
- 활성 사용자/캐릭터의 활성 상품·아이템만 반환한다. 목록은 참고값이며 구매 시 잠금 후 다시 검사한다.

POST /api/shop/products/:productId/buy

```json
{"quantity": 1, "requestKey": "UUID"}
```

반환 data: purchaseId, productId, itemId, quantity, unitPrice, totalPrice, currency,
inventoryQuantity, personalRemaining, globalRemaining.

오류: INVALID_PRODUCT_ID / INVALID_PURCHASE / INVALID_REQUEST_KEY (400), CHARACTER_NOT_FOUND /
PRODUCT_NOT_FOUND (404), CHARACTER_DEAD / SHOP_POLICY_HOLD / ITEM_UNAVAILABLE /
PERSONAL_LIMIT_EXCEEDED / OUT_OF_STOCK / NOT_ENOUGH_CURRENCY / INVENTORY_LIMIT_CONFLICT /
DUPLICATE_REQUEST (409). memory에서는 SHOP_UNAVAILABLE (501).
정수 DB 저장 범위 초과와 안전 정수 금액 범위 초과를 검증한다. 이 제한은 밸런스 수치가 아니다.

## 실제 호출과 트랜잭션

shopRoutes → createShopService.getProducts/buy → createShopRepository.getShopProducts/buyProduct.
service는 ID·수량·UUID·허용 필드를 검증한다. repository가 DB 상태와 한도를 잠금 아래 검사한다.

buyProduct:
BEGIN → ACTION_LOG requestKey 사전 검사 → 상품 FOR UPDATE → lockCharacterByUser (사용자/캐릭터 잠금)
→ requestKey 재검사 → 상태 검증 → 아이템 FOR UPDATE → 구매 이력 개인/전체 SUM
→ 한도/재화/인벤토리 저장 범위 검증 → changeCharacterResources(currency 차감)
→ changeInventoryQuantity → SHOP_PURCHASE INSERT → writeActionLog → COMMIT.
실패 시 ROLLBACK, finally client.release. 공통 자원 함수의 clamp에 의존하여 부족 재화를 허용하지 않는다.

상점끼리 상품 → 사용자/캐릭터 → 아이템 → 인벤토리 순서를 통일한다.
상품 행 잠금이 개인/전체 SUM 검사와 구매 이력 INSERT를 직렬화하여 마지막 재고도 한 번만 판매된다.
동일 캐릭터가 서로 다른 상품을 구매할 때는 캐릭터 잠금으로 재화/인벤토리를 보호한다.
기존 조사·창고처럼 캐릭터를 아이템보다 먼저 잠근다. 이번 API는 한 요청에 상품 하나만 처리한다.

requestKey 중복은 기존 조사와 동일하게 409로 거부한다(기존 결과 재전송 없음).
같은 키를 다른 수량/상품/사용자에 재사용해도 허용하지 않는다.
서로 다른 상품에서 동시 요청해 사전 검사를 함께 통과해도 구매 이력/ACTION_LOG UNIQUE가 마지막 방어선이고 패자는 전체 rollback된다.
ACTION_LOG category=SHOP, action_type=SHOP_PURCHASE, target_type=SHOP_PRODUCT.
detail에 상품/아이템/구매 ID, 수량, 단가/총액, 재화·인벤토리 전후 및 잔여 한도를 남긴다.

## DEV 콘솔

frontend/src/dev/ShopPanel.js를 App의 접이식 상점 영역에 연결했다.
기존 api/client를 사용하며 Supabase 직접 접근은 없다. 로그인/전체 갱신 시 목록도 조회한다.
수량·개인/전체 잔여 수량을 표시하고 구매마다 UUID를 생성한다. 공통 busy와 ref로 연속 클릭을 차단한다.
서버 실패는 코드/메시지로 표시하며 이전 성공 표시를 지운다. 성공 후 전체 상태를 재조회한다.
재조회 실패는 이미 성공한 구매와 구분하며 자동 재구매하지 않는다.

현재 실제 상품이 0건이므로 화면에는 '등록된 판매 상품이 없습니다'가 정상이다.
이번 작업은 상품 seed나 관리자 CRUD를 추가하지 않는다. 수동 검증에는 별도 DEV 아이템을 사용하는
SHOP_PRODUCT를 준비하고 가격/개인 한도/전체 한도를 명시해야 한다. 기존 운영 상품을 테스트용으로 변경하지 않는다.
구매 이력이 생긴 테스트 상품은 비활성화하면 목록에서 제외되며 이력을 삭제해 한도를 초기화하지 않는다.

## 테스트

```powershell
$env:RUN_SHOP_DB_TESTS='1'
node --test --test-reporter=spec server/test/shop*.test.js
Remove-Item Env:RUN_SHOP_DB_TESTS
```

실제 PostgreSQL 동시 연결 테스트는 UUID 이름의 DEV 캐릭터 2개/계정 2개/아이템/상품 2개만 생성한다.
finally에서 이 실행의 ID만 역순 삭제한다. 운영 데이터는 변경하지 않는다. 시퀀스는 증가할 수 있다.
강제 종료 시 finally가 실행되지 않을 수 있으므로 DEV shop test / DEV shop item 이름과 참조를 확인한다.
개인/전체/동시 한도, 마지막 재고, 동일 키 경쟁, 다른 상품의 동일 키 경쟁, 부족 재화, DEAD/HOLD,
로그 실패 rollback, 무료 상품, 저장 범위, HTTP 인증/검증을 포함한다.
프론트는 표시/수량 검증/UUID/중복 클릭/오류/갱신 테스트를 수행한다.

NEAR_DEATH 정책 확정 시 repository의 SHOP_POLICY_HOLD 분기와 ShopPanel의 HOLD 표시를 함께 재검토한다.
재입고 자동화, 구매 취소/환불, 관리자 CRUD, 가챠 및 다른 게임 기능은 구현하지 않았다.
