# 일반 PVE (2026-10-29)

일반 PC 1명 대 마물 1마리. 실제 최종 명세와 DB를 확인하고 기존 AUTH_USER,
GAME_CHARACTER, BATTLE, BATTLE_LOG, INVENTORY, ACTION_LOG를 재사용했다.
전체 작업 내용과 운영 전 확인사항은 루트 `PVE-2026-10-29.md`를 참고한다.

## 요청 흐름

- 조사: `investigate` → 캐릭터 잠금 → `ensureNoActiveBattle` → AP 변경 →
  `encounter` → 지역 조우 확률/가중치 → 마물·행동·드롭·이능 설정 스냅샷 →
  BATTLE 생성 → 기존 조사 보상/진행도 처리 → 조사 로그 → 같은 트랜잭션 commit.
- `POST /api/battles/:id/commands` → `battleRoutes` / `validateBattleCommand` →
  `commandBattle` → `actionTransaction` BEGIN → `lockCharacterByUser` →
  `rejectActionDuplicate` → 소유 BATTLE FOR UPDATE → timeout / turnNo 검증 →
  아이템 ID 순서 잠금 → `resolveTurn` → `changeInventoryQuantity` /
  `changeCharacterResources` → 승리 보상 → BATTLE/BATTLE_LOG/ACTION_LOG → COMMIT.
- 실패는 `actionTransaction`에서 ROLLBACK, `AppError`는 기존 `errorHandler`가 HTTP로 변환.
- `GET /api/battles/current`, `GET /api/battles/:id`는 선언/턴/상태를 복구한다.
  last_command_at을 갱신하지 않는다. 만료된 전투는 패배로 확정하므로 완전한 무변경 GET은 아니다.

## 커맨드

```json
{"requestKey":"UUID", "turnNo":1, "action":"ATTACK"}
```

ITEM에만 숫자 문자열 `itemId`가 필요하다. 액션은 ATTACK, ABILITY, DEFEND,
ITEM, FLEE, BLOCK_FLEE. 서버 응답의 options가 현재 선언에 가능한 선택지다.
타인의 전투 조회/명령은 불가. 요청의 damage/characterId/보상 등은 허용하지 않는다.
UUID 중복은 기존 서비스처럼 409 DUPLICATE_REQUEST이며, 다른 UUID의 같은 턴도
STALE_BATTLE_TURN으로 거절한다. 종료 전투는 BATTLE_FINISHED.

## 계산 및 원자성

`engine.js`는 난수 함수를 주입받는 순수 계산이다. 일반/특수/이능 공격, 방어와
무비용 반격, 도주/차단, 혈액팩을 처리한다. 공격 비용을 확인한 후 혈량이 0이 돼도
양측 피해를 계산하고 마물 HP 0 승리를 우선한다. 공통 자원 함수가 사망/빈사와
death_count, DEATH 로그를 처리한다. 사망·빈사 승리에도 스냅샷 전리품을 지급한다.
ACTION_LOG에는 계산 피해·난수·자원 전후·보상이, BATTLE_LOG.damage에는 실제 감소 HP가 기록된다.

마물 행동의 활성 probability 합계는 고객 확인에 따라 100%. condition_type/value
판정은 미확정으로 HOLD하며 기존 조건을 삭제하거나 무시하지 않는다.
드롭 확률은 각 행의 drop_rate, 수량은 min_quantity~max_quantity 균등 정수다.
기존 전투는 마물·행동·드롭 및 이능 설정 스냅샷을 사용한다. 이후 비활성화한
아이템도 이미 확정된 스냅샷 전리품으로는 지급한다(참조 아이템 삭제는 지원하지 않음).
전투 아이템 사용은 현재 명시적으로 구현된 BLOOD_PACK만 지원하며 battle_usable이 필요하다.
일반 식사/혈액팩 사용 API로 전투 턴을 우회할 수 없다.

## 잠금 및 만료

- 조사: area → auth/character → monster ID 오름차순 → item ID 오름차순.
- 전투 커맨드: auth/character → battle → item ID 오름차순.
- 관리자 마물 변경: area ID 오름차순 → ADMIN auth → monster → item.
  area 변경까지 같은 트랜잭션에서 관리하여 조우 중 혼합 스냅샷을 방지한다.
- 기존 `uq_battle_active_character`와 캐릭터 잠금을 함께 사용한다.
- `expireBattles`: character → battle, DB 시각으로 마지막 정상 커맨드(없으면 시작)
  이후 24시간 이상이면 DEFEAT/TIMEOUT. 자원/보상 변경 없음. 로그도 한 번만 기록.
- `startBattleExpiry`: 기동 시 및 매 60초 재검사, 100건 단위 처리, 여러 인스턴스 안전.
  조회/커맨드도 즉시 만료 검사한다. 실제 배포나 기존 실행 서버 재시작은 하지 않았다.

## 관리자

기존 ADMIN middleware + 쓰기 트랜잭션 역할 재검증. 마물 목록/상세/등록/수정,
이능 배율/AP 설정, OAuth 검증 계정의 승인 캐릭터 등록을 제공한다.
목록은 최대 100건. 대규모 목록 페이지네이션은 후속 개선 대상이다.
React 관리자 `PVE·캐릭터 등록` 메뉴에서 기존 아이템 검색 선택기를 재사용한다.

## 수정할 위치

계산: engine.js / 커맨드·보상·잠금: repository.js / HTTP 입력: routes.js /
만료 주기: scheduler.js / 관리자 검증·저장: admin/battle-repository.js /
조우 연결: investigation/repository.js / 공통 사망·빈사: shared/game.js(이번 변경 없음).
