# 05. 첫 테이블 — 마이그레이션과 표 설계

날짜: 2026-09-12 · 파일: [migrations/001_init.sql](../../migrations/001_init.sql) · [src/infra/postgres/](../../src/infra/postgres/) · [src/domain/geo/distance.ts](../../src/domain/geo/distance.ts) · [src/scripts/migrate.ts](../../src/scripts/migrate.ts) · [src/scripts/load-route.ts](../../src/scripts/load-route.ts)

## 만든 것

표 4개와, 그 표에 노선 하나를 통째로 넣는 적재 함수, 그리고 그걸 도는 테스트 7개.

```
fixtures/gbis/{stations,line}-7002.json
   → parseStations / parseLine   (3단계)
   → cumulativeDistancesM        (형상 점마다 출발점부터 누적 m)
   → loadRoute(db, …)            (한 트랜잭션으로 route · station · route_station · route_shape)
```

## 개념 1 — 마이그레이션: DB 모양의 git

DB는 코드와 달리 **상태를 가진다.** 표를 만들면 그 표는 거기 남는다. 새 컴퓨터, 새 환경(Neon)에서 같은 모양을 얻으려면 "표를 이렇게 만들어라"를 **파일로** 남기고 순서대로 돌려야 한다. 그 파일이 마이그레이션이다.

```
migrations/001_init.sql     ← 표 4개 CREATE
migrations/002_....sql      ← 나중에 vehicle_observation 추가
```

`runMigrations`는 이 폴더를 이름순으로 읽고, **아직 안 돈 파일만** 실행한다. 뭐가 돌았는지는 DB 안의 `schema_migration` 표에 적어 둔다. 그래서 몇 번을 실행해도 두 번째부터는 "할 것 없음"이다.

프론트로 치면 git이다. 커밋(파일) 하나하나가 변경이고, 순서가 있고, 이미 적용된 건 다시 적용하지 않는다. 다른 점은 **되돌리기가 없다**는 것. 표를 지우는 마이그레이션은 데이터도 지운다. 그래서 001을 고치지 않고 002를 **추가**한다.

파일 하나는 트랜잭션 하나로 묶여서, 중간에 실패하면 그 파일 전체가 없던 일이 된다. 트랜잭션 자체는 6단계에서 제대로 만난다.

## 개념 2 — 표를 나누는 기준: 무엇이 무엇을 가리키나

정류소 데이터를 표 하나에 다 넣을 수도 있다. `(route_id, seq, station_id, station_name, lng, lat)` 61행. 그런데 두 노선이 같은 정류소를 지나면 이름과 좌표가 두 번 저장되고, 정류소 이름이 바뀌면 두 곳을 고쳐야 한다. 그래서 **"정류소 그 자체"와 "이 노선의 N번째"를 나눈다.**

| 표 | 한 행의 뜻 | 기본키(PK) |
|---|---|---|
| `route` | 노선 하나 | `id` (GBIS routeId) |
| `station` | 정류소 하나. 방향별로 id가 다르다 (윗벌 239000859 / 239000860) | `id` (GBIS stationId) |
| `route_station` | "노선 R의 seq번째는 정류소 S다" | `(route_id, seq)` 둘이 합쳐서 |
| `route_shape` | 노선 R의 폴리라인 seq번째 점 | `(route_id, seq)` |

- **기본키(PK)**는 "행을 딱 하나로 집는 값"이다. 같은 값이 두 번 들어오면 DB가 거부한다. 테스트 마지막이 이걸 이용한다.
- **외래키(FK)** `REFERENCES route (id)`는 "이 값은 저 표에 있어야 한다"는 약속이다. 없는 노선을 가리키는 `route_station`을 넣으면 DB가 막는다(테스트 6번째). 프론트로 치면 TS가 `routeId: RouteId` 타입으로 아무 숫자나 못 넣게 하는 것인데, 이건 **런타임에, 데이터 자체에** 걸린다.

프론트로 치면 Zustand에서 `stations: Record<id, Station>`(정규화된 엔티티)과 `routeStationIds: id[]`(순서)를 따로 두는 것과 같다. 이름만 다르지 같은 판단이다.

## 이번에 지나가면서 본 것 (이름만)

- **`ON CONFLICT (id) DO UPDATE`** — "있으면 갱신, 없으면 삽입". 적재를 몇 번 돌려도 행이 안 는다. 6단계 "멱등성"에서 제대로.
- **`unnest($1::int[], $2::text[], …)`** — 배열 4개를 한 번에 보내 행 61개를 만든다. 행마다 INSERT를 보내면 Neon까지 왕복 61번(형상은 1,512번)이다. 네트워크 왕복 횟수가 DB 성능의 첫 번째 변수다.
- **`integer` vs `bigint`** — GBIS id는 9자리라 `integer`(21억까지)로 충분하다. `bigint`로 하면 pg 드라이버가 JS 숫자 정밀도 때문에 **문자열**로 돌려줘서 `=== 239000859` 비교가 조용히 실패한다.
- **`$1` 파라미터** — 값은 SQL 문자열에 끼워 넣지 않고 배열로 따로 넘긴다. SQL 인젝션을 막는 방식이고, 지금부터 예외 없이 이렇게 쓴다.
- **인덱스·EXPLAIN은 아직 안 만났다.** 표가 작고(최대 2,487행) PK로만 찾는다. 관측이 하루 3천 행씩 쌓이는 표가 생기면 그때 만난다.

## 테스트는 어떻게 했나

Neon 없이 돈다. **PGlite**라는 Postgres를 WebAssembly로 빌드한 것을 테스트 안에서 메모리에 띄운다. 진짜 Postgres 18이라 같은 SQL이 Neon에서도 그대로 돈다. 저장소 코드는 `Queryable`("SQL과 파라미터를 받아 rows를 주는 것")이라는 작은 인터페이스만 보게 해서, `pg`의 연결과 PGlite를 바꿔 끼운다. 4단계에서 `fetch`를 주입한 것과 같은 수법이다.

검사하는 것: 마이그레이션 두 번 실행 → 두 번째는 0개 · 7002 적재 후 정류소 61, 형상 1,512 · 윗벌이 seq 15와 48에 각각 다른 id로 · 두 번 적재해도 행 수 동일 · 세 노선이 안 섞임 · FK 위반 거부 · 적재 중 실패 시 이전 상태 유지.

## 직접 해보기 — Neon에 진짜로

1. https://neon.tech 에서 GitHub 계정으로 가입 (무료, 카드 없음)
2. 프로젝트 하나 생성. Region은 **Singapore (ap-southeast-1)** — 한국에서 가장 가깝다
3. 대시보드의 **Connection string**을 복사 (`postgresql://…@ep-….neon.tech/neondb?sslmode=require`)
4. `.env`에 한 줄 추가. 키와 마찬가지로 채팅에는 붙이지 않는다

```bash
echo 'DATABASE_URL=여기에_connection_string' >> .env
```

5. 마이그레이션 → 7002 적재 (fixture로, GBIS 호출 0건)

```bash
pnpm build && node --env-file=.env dist/scripts/migrate.js && node --env-file=.env dist/scripts/load-route.js 239000141 --fixture
```

6. Neon 콘솔의 SQL Editor에서 직접 확인해 본다. 처음 쓰는 SQL이다.

```sql
SELECT rs.seq, s.name, s.lng, s.lat
FROM route_station rs
JOIN station s ON s.id = rs.station_id
WHERE rs.route_id = 239000141
ORDER BY rs.seq;
```

`JOIN`은 "route_station의 station_id로 station 표를 찾아 옆에 붙여라"다. 표를 나눠 놓은 대가로 읽을 때 이렇게 붙인다.

## 실제로 돌린 결과 (2026-09-12)

```
적용: 001_init.sql
7002 (239000141) [fixture]: 유명산종점 ↔ 잠실역.롯데월드
  정류소 61개 · 형상 1512점 · 총 길이 116.4km
```

막혔던 곳 둘. (1) `.env`에 Neon 문자열 대신 `postgres://user:…@localhost:5432/mydatabase` 예시가 들어가 있어서 `ECONNREFUSED 127.0.0.1:5432`. 에러의 주소를 읽으면 "Neon이 아니라 내 맥으로 갔다"가 바로 보인다. (2) 연결 문자열을 채팅에 붙였다 → Connect 창의 **Reset password**로 비밀번호 교체. 연결 문자열은 통째로 비밀이다.

`pg`가 찍는 SSL 경고는 `sslmode=require`를 `verify-full`로 바꿔 넣어 없앴다(`pool.ts`). 뜻은 같고 이름만 명시한 것이다.
