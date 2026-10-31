# 요리·식사 API / DEV 콘솔

## 확정 규칙

- RECIPE.learn_cost 재화를 지불하여 CHARACTER_RECIPE에 한 번 습득한다.
- 요리에는 습득한 활성 레시피와 RECIPE_INGREDIENT의 **전체 요구량 보유**가 필요하다. 재료 부족은 추첨 전에 거부한다.
- 성공률은 RECIPE.success_rate. 성공은 재료 전량 소모 / 완성 음식 4개, 실패는 각 재료별 floor(quantity / 2) 소모 / 실패 음식 1개.
  예: 재료 3개와 1개가 필요하면 실패 소모는 각각 1개와 0개. 실패도 AP를 소비하며 정상적인 처리 결과다.
- 요리 AP는 SYSTEM_CONFIG.cooking_ap_cost (기본 1). 요청당 한 번 읽은 값으로 부족 검사와 차감을 함께 수행한다.
- 식사는 본인 음식 1개를 소비하고 daily_meal_count를 1 증가시킨다. 기존 CHECK 및 정책에 맞춰 최대 5회.
- FOOD_CONFIG의 blood_recovery를 적용하되 max_blood에서 제한한다.
- stat_growth_enabled일 때 stat_growth_rate 확률로 음식별 고정 stat_growth_target에 stat_growth_value 적용.
  permanent_stat_cap을 읽어서 남은 상한까지만 증가한다. 대상 스탯이 이미 상한이면 다른 스탯으로 대체하지 않는다.
  성장 실패/상한/전체 상한이어도 혈량 회복, 음식 소비, 식사 횟수는 정상 적용한다.
- 확률은 기존 investigation/random.js의 winsReward/randomUnit을 재사용하고 repository 생성 시 RNG를 주입할 수 있다.

## HOLD와 기존 기반의 경계

DEAD 행동 금지. NEAR_DEATH의 요리·식사·레시피 습득 근거가 없어 COOKING_POLICY_HOLD로 보류했다.
목록은 조회할 수 있다. 이것은 확정된 영구 금지 규칙이 아니다.
일일 초기화 자동 실행/기준일/소급 정책은 기존 DAILY-FOUNDATION의 HOLD를 유지한다.
식사 API는 기존 daily_meal_count를 검증할 뿐 날짜가 바뀌었다고 직접 0으로 만들지 않는다.
따라서 현재 자동 일일 초기화가 활성화되지 않은 서버에서는 자정 후에도 카운터가 자동 복구되지 않는다.
해당 정책 확정 및 기존 일일 초기화 연결 전까지 운영용 일일 주기는 완성되지 않은 상태다.
빈사 해제, 전투 중 음식 사용, 타인에게 음식 사용은 구현하지 않는다.

## 실제 스키마 확인과 migration

확인 시 RECIPE/FOOD_CONFIG 모두 0건이었다.
RECIPE.result_quantity DEFAULT 1은 성공 4개와 충돌했다.
`supabase/migrations/20261009052621_cooking_ap_and_recipe_default.sql`을 적용했다.
- cooking_ap_cost = JSONB 숫자 1 추가. 기존 키가 있으면 덮어쓰지 않는다.
- recipe.result_quantity DEFAULT를 4로 변경. 기존 행 UPDATE는 없다.
- 값이 4가 아닌 레시피는 RECIPE_CONFIG_INVALID로 요리를 거부하여 다른 수량을 조용히 지급하지 않는다.
- 실패 가능(success_rate < 100)인데 failure_item_id가 없거나 재료가 없는 레시피도 설정 오류다.
- daily_meal_count CHECK 0..5 유지. ATK/DEF/AGI는 현재 비음수 CHECK만 있고 상한은 서비스가 적용한다.
- FOOD_CONFIG 고정 성장 컬럼/제약은 변경하지 않았다. 기존 스탯 및 운영 데이터는 수정하지 않는다.

## API와 파일별 역할

기존 Bearer 인증, `{ok,data,requestId}` envelope 사용. memory 모드는 COOKING_UNAVAILABLE(501).

- GET /api/cooking/catalog → recipes(learned, ingredients 포함), foods(보유 음식 설정/수량), cookingApCost,
  dailyMealCount/dailyMealLimit, successQuantity/failureQuantity.
- POST /api/cooking/recipes/:recipeId/learn
- POST /api/cooking/recipes/:recipeId/cook
- POST /api/cooking/foods/:itemId/eat

POST body는 모두 `{ "requestKey": "UUID" }`만 받는다. 사용자·가격·확률·수량·스탯을 클라이언트가 지정하지 않는다.

routes.js의 cookingRoutes는 인증 후 세션 user.id를 전달한다.
service.js의 createCookingService는 bigint ID, UUID 및 허용 필드를 검증하고 learn/cook/eat에서 repository 호출.
repository.js의 createCookingRepository는 getCookingCatalog/learnRecipe/cookRecipe/eatFood를 제공한다.
transact가 BEGIN/COMMIT/ROLLBACK, requestKey 검사와 ACTION_LOG를 공통 처리한다.
서비스/저장소에서 만든 AppError는 기존 app.js의 errorHandler가 HTTP 오류 envelope로 변환한다.

### 요리 1회 호출 추적

POST /api/cooking/recipes/ID/cook → cookingRoutes → service.cook → repository.cookRecipe → transact:

BEGIN → ACTION_LOG 키 검사 → shared lockCharacterByUser(사용자/캐릭터 FOR UPDATE)
→ 키 재검사/상태 검증 → activeRecipe(RECIPE FOR SHARE) → CHARACTER_RECIPE 습득 확인
→ 설정 및 AP 검사 → RECIPE_INGREDIENT FOR SHARE → 아이템 ID 오름차순 FOR UPDATE
→ 인벤토리 FOR UPDATE 및 재료 전량 검사 → success_rate 추첨
→ shared changeCharacterResources(AP 차감) → shared changeInventoryQuantity(재료 소모/결과 지급)
→ shared writeActionLog → COMMIT → 성공/실패 결과, 소모 재료, 지급 음식, 변경 후 AP 반환.

습득은 같은 캐릭터 잠금 아래 learn_cost 검사/차감과 CHARACTER_RECIPE INSERT를 함께 처리한다.
식사는 같은 캐릭터 잠금 아래 횟수/보유 음식 확인, FOOD_CONFIG FOR SHARE, 상한 설정 조회,
공통 인벤토리 감소/혈량 회복, 스탯 및 횟수 UPDATE를 함께 처리한다.
모든 예외는 전체 rollback하며 finally에서 client.release한다.
식사 스탯 수정 지점은 eatFood의 고정 대상 매핑과 cap 적용 부분이다.

### 동시성과 ACTION_LOG

사용자/캐릭터 → 레시피(요리/습득) → 아이템 ID 오름차순 → 음식 설정(식사) → 인벤토리 순서다.
기존 조사/창고/상점처럼 캐릭터를 아이템보다 먼저 잠근다.
같은 캐릭터의 동시 습득/마지막 AP/마지막 식사 횟수는 직렬화한다.
기존 ACTION_LOG.request_key UNIQUE와 잠금 전후 중복 검사 사용. 키 재사용은 기존 조사와 같이 409 DUPLICATE_REQUEST.
서로 다른 캐릭터가 같은 키로 경쟁해 사전 검사를 통과해도 UNIQUE 충돌 패자는 전체 rollback한다.
과거 성공 응답을 재전송하는 방식은 아니다. 같은 키를 다른 행동에 재사용할 수도 없다.

category=COOKING, action_type=LEARN_RECIPE/COOK/EAT, target_type=RECIPE/ITEM.
detail은 결과 응답과 동일하며 비용/재화 전후, 재료 소모/결과 음식/AP 전후 또는 혈량 전후/식사 횟수/성장 내역을 기록한다.

## DEV 콘솔

frontend/src/dev/CookingPanel.js를 App의 접이식 요리·식사 영역에 추가했다.
기존 run/busy/refreshAll/api client 사용. UUID 생성, 중복 클릭 방지, 오류 코드 표시, 성공 후 모든 패널 재조회.
실패 요리는 정상 응답이며 실패/소모/지급을 표시하고 상태를 갱신한다.
DB 직접 접근이나 결과 수치의 프론트 임의 계산은 없다.
현재 실데이터가 비어 있으므로 레시피/음식 빈 목록이 정상이다. seed나 관리자 CRUD는 추가하지 않았다.
수동 검증용 데이터는 활성 레시피(수량4/결과 및 실패 아이템), 재료, 음식 설정, 본인 DEV 재화·재료를 준비해야 한다.
운영 데이터를 테스트 상태로 변경하거나 식사 카운터를 임의 초기화하지 않는다.

## 테스트

```powershell
$env:RUN_COOKING_DB_TESTS='1'
node --test --test-reporter=spec server/test/cooking*.test.js
Remove-Item Env:RUN_COOKING_DB_TESTS
```

PostgreSQL 테스트는 UUID 이름의 DEV cooking test 캐릭터/계정 2개, DEV cooking item 4개와 전용 레시피를 생성한다.
동시 연결 테스트를 위해 commit 후 사용하며 finally에서 이 실행의 ID만 역순 삭제한다.
설정 변경 테스트는 외부 트랜잭션/savepoint로 격리하고 rollback한다. 기존 설정을 영구 변경하지 않는다.
강제 종료 시 finally가 실행되지 않을 수 있다. identity 시퀀스는 증가한다.
HTTP 인증/검증/응답, 성공/실패 확률 경계, 재료/AP/재화 부족, 고정 스탯/상한/확률,
일일 5회, 동시성, UUID 중복 및 오류 rollback을 검증한다.
프론트 테스트는 서버 비용, 습득 여부/횟수/HOLD, API 경로/UUID, 실패 요리 표시, 중복 클릭/오류/재조회를 검증한다.
