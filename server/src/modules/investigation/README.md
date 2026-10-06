# Investigation API v1

기존 Bearer 세션 및 공통 `{ok,data,requestId}` 응답을 사용한다. Supabase 전용이며,
memory 모드의 기존 기능은 유지하고 조사 요청에는 `501 INVESTIGATION_UNAVAILABLE`을 반환한다.

## API

- `GET /api/investigation/areas`: 활성 캐릭터 소유권을 확인한 뒤 접근 가능한 지역만 `data.areas`로 반환한다.
  DEAD는 409이며 AP 부족은 목록 조회를 막지 않는다. 닫힌 지역·미래에 열릴 지역은 목록에서 제외한다.
- `POST /api/investigation/:areaId`: body는 `{ "requestKey": "UUID" }`만 허용한다.
  지역 ID는 bigint 범위의 양의 정수 문자열이다. UUID는 기존 inventory 검증과 동일한 v1~v5 형식을 사용한다.

POST의 `data`:

```json
{
  "result": {"id":"2","result_grade":"NORMAL","result_text":"결과","is_unique":true,"investigation_rate_value":15},
  "rewards": [{"rewardId":"5","itemId":"3","name":"식량","quantity":2,"inventoryQuantity":2}],
  "clue": null,
  "firstDiscovery": true,
  "area": {"id":"1","name":"폐허","description":null,"image_url":null,"is_open":true,"unlock_at":null,"investigation_rate":15},
  "ap": 4
}
```

`clue`는 연결된 clue 행 또는 null이다. 이번 범위에서는 단서 정보를 반환하며
clue의 `is_discovered/first_discoverer_id/discovered_at`을 갱신하는 별도 발견 정책은 추가하지 않는다.

## 스키마 및 규칙

- area에 is_active가 없어 사용자 합의대로 `is_open=true`와 `unlock_at IS NULL OR unlock_at<=현재 DB 시각`을 사용한다.
- 활성 investigation_result만 대상으로 weight의 합에 대한 비율로 하나를 뽑는다.
- investigation_reward는 아이템 보상 전용이다. 각 보상 행의 probability(0~100)를 독립 판정한다.
  0은 미지급, 100은 항상 지급한다. 당첨된 비활성 아이템은 `409 REWARD_UNAVAILABLE`로 전체 rollback한다.
- unique_discovery의 investigation_result_id UNIQUE 제약을 이용해 전역 최초 발견을 기록한다.
  최초일 때만 investigation_rate_value를 더하고 area의 CHECK 범위에 맞게 100에서 제한한다.
  재등장은 일반 보상/AP/단서 처리를 계속한다. 결과 추첨에서 이미 발견된 unique를 제거하지 않는다.
- AP가 1 이상인 살아 있는 활성 캐릭터만 실행한다. AP -1은 기존 공통 자원 함수를 사용한다.
- 스키마 변경, migration, 신규 라이브러리는 없다.

## 트랜잭션과 잠금

begin → 중복 확인 → 지역 FOR UPDATE 및 개방 검증 → 사용자/캐릭터 FOR UPDATE → 중복 재확인
→ 캐릭터/AP 검증 → 결과 FOR SHARE/추첨 → 공통 AP 차감 → 최초 발견 INSERT ON CONFLICT DO NOTHING
→ 최초일 때 진행률 UPDATE → 보상 FOR SHARE 및 아이템 ID 오름차순 FOR UPDATE/공통 수량 변경
→ 단서 조회 → 공통 ACTION_LOG → commit.

동일 지역 조사는 직렬화한다. 캐릭터 잠금은 인벤토리 입출고와 공유하여 아직 없는 인벤토리 행의
동시 생성도 보호한다. 아이템 다중 잠금은 ID 오름차순을 따른다.
로그 request_key UNIQUE 위반은 전체 rollback 후 `409 DUPLICATE_REQUEST`로 변환한다.
재시도 시 과거 응답을 재전송하지 않으며, 이미 처리했다는 오류를 반환한다.

로그 category=INVESTIGATION, action_type=INVESTIGATE, target_type=AREA.
detail에는 area_id/result_id/rewards/clue_id/first_discovery/진행률 전후/AP 전후를 기록한다.
모든 실패는 rollback, 모든 경로는 client.release를 수행한다.

## 테스트

프로젝트 루트 PowerShell:

```powershell
npm.cmd test
# 실제 Supabase 검증 포함
$env:RUN_INVESTIGATION_DB_TESTS='1'
npm.cmd test
Remove-Item Env:RUN_INVESTIGATION_DB_TESTS
```

일반 테스트는 DB 연결 없이 HTTP 인증·검증·응답, 가중치·보상 확률, 상태와 오류 및 SQL 잠금 순서를 확인한다.
PostgreSQL 통합 테스트는 외부 트랜잭션 안에 검증용 레코드를 만들고 repository 트랜잭션을 savepoint로
감싸 실제 지급·최초 발견·타 캐릭터 재발견·중복·오류 rollback을 검증한다. 마지막에 전체 rollback하므로
검증 레코드를 남기지 않는다. PostgreSQL identity 시퀀스 번호는 증가할 수 있다.
실제 동시 다중 연결 부하 테스트는 포함하지 않는다.

프론트엔드, 관리자 CRUD, 몬스터 인카운터, battle 생성, 별도 단서 발견 정책은 구현하지 않는다.
