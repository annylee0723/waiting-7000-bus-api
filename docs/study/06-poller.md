# 06. 폴러 — 서버가 혼자 계속 뭔가 하기 시작한다

날짜: 2026-09-27 · 파일: [migrations/002_observation.sql](../../migrations/002_observation.sql) · [src/domain/budget/schedule.ts](../../src/domain/budget/schedule.ts) · [src/application/poll-once.ts](../../src/application/poll-once.ts) · [src/infra/postgres/observation-repo.ts](../../src/infra/postgres/observation-repo.ts) · [src/infra/nest/poller.service.ts](../../src/infra/nest/poller.service.ts) · [poller.module.ts](../../src/infra/nest/poller.module.ts)

## 만든 것

지금까지는 "명령을 치면 한 번 도는" 스크립트였다. 이번엔 서버를 켜 두면 **사람 없이** 60~120초마다 GBIS를 묻고 관측을 쌓는다. 처음으로 3층이 다 쓰인다.

```
infra/nest/PollerService        타이머. "끝나면 다음을 예약"
   └─ application/PollOnce      유스케이스: GBIS 묻기 → 저장. Nest 모름
        ├─ domain/ports.GbisPort        ← infra/gbis/HttpGbisClient (4단계)
        ├─ domain/ports.ObservationRepo ← infra/postgres/PgObservationRepo (이번)
        └─ domain/ports.Clock           ← { now: () => new Date() }
   └─ domain/budget/pollIntervalMs      지금 몇 초 간격인가 (KST 기준). 순수 함수
```

표 둘이 늘었다(002). `poll_run`은 "폴 한 번 = 한 행"으로 폴러가 살아 있는지 보는 용도, `vehicle_observation`은 "차량 한 대의 관측 한 번 = 한 행"이다. 둘 다 **append-only**: 갱신하지 않고 쌓기만 한다. 관측 표에 `UNIQUE (route_id, plate_no, observed_at)`를 걸어 같은 응답을 두 번 저장해도 행이 안 는다(멱등, 5단계에서 이름만 봤던 것). 저장은 관측 + 폴 기록을 한 트랜잭션으로 묶었다.

## 개념 1 — 재진입 방지: 왜 `setInterval`이 아닌가

프론트에서 60초마다 갱신이라면 `setInterval(fetch, 60000)`을 쓴다. 서버에서 그렇게 하면 문제가 하나 있다. GBIS가 70초 걸리면(타임아웃 5초 × 재시도 3번 + 백오프면 충분히 그렇다) 60초째에 **다음 틱이 그 위에 올라탄다.** 두 폴이 동시에 돌고, DB 연결도 둘, 응답 순서도 뒤집힐 수 있다. 한 번 밀리면 계속 밀린다.

그래서 `setInterval` 대신 **"이번 폴이 끝나면 다음을 예약"** 한다.

```ts
async tick() {
  ... 폴 ...            // 끝날 때까지 기다리고
  setTimeout(tick, ms)  // 그 다음에 예약
}
```

이러면 구조적으로 겹칠 수 없다. 더해서 `inFlight` 플래그를 하나 둬서, 나중에 수동 트리거 같은 다른 경로로 `tick()`이 불려도 앞 폴이 안 끝났으면 그냥 돌아간다. 프론트로 치면 버튼 연타를 막는 `isLoading` 가드다. 이름은 **재진입 방지(re-entrancy guard)**. Spring이면 `@Scheduled` + ShedLock이 같은 역할이다.

테스트가 이걸 직접 확인한다. 1초 걸리는 가짜 폴을 돌리는 중에 `tick()`을 두 번 더 불러도 호출은 1번, 동시 실행 최대 1.

## 개념 2 — 인덱스: 관측 표는 자란다

5단계 표들은 커야 2,487행이고 PK로만 찾아서 인덱스가 필요 없었다. 관측 표는 다르다. 하루 780폴 × 차량 수만큼 쌓인다. 한 달이면 수만 행이다.

"7002의 어제 관측 전부"를 찾을 때 인덱스가 없으면 DB는 표를 **처음부터 끝까지** 읽는다(Seq Scan). 인덱스는 특정 컬럼 순서로 정렬된 별도의 찾기표라, 그 컬럼으로 찾을 땐 필요한 부분만 읽는다. 대신 쓸 때마다 찾기표도 갱신해야 해서 INSERT가 조금 느려진다. 그래서 아무 데나 걸지 않는다.

```sql
UNIQUE (route_id, plate_no, observed_at)                       -- 멱등용. 이것도 인덱스다
CREATE INDEX vehicle_observation_route_time ON vehicle_observation (route_id, observed_at);
```

왜 둘 다인가: UNIQUE가 만든 인덱스는 `route_id → plate_no → observed_at` 순으로 정렬돼 있다. "이 노선의 이 차량"은 빠르지만 "이 노선의 이 기간"은 plate_no를 모르니 못 탄다. 전화번호부가 성→이름 순일 때 "김씨 중 서울 사는 사람"은 빠르지만 "서울 사는 사람 전부"는 처음부터 읽어야 하는 것과 같다. 그래서 `(route_id, observed_at)` 인덱스를 따로 건다. 정말 타는지는 관측이 좀 쌓인 뒤 `EXPLAIN`으로 본다(다음 단계 중 하나).

프론트로 치면 배열을 `find`로 훑는 것과 `Map`으로 바로 집는 것의 차이인데, DB는 컬럼마다 Map을 따로 만들 수 있고, 만들 때마다 비용이 든다.

## 이번에 지나가면서 본 것

- **폴링 예산이 코드가 됐다.** `pollIntervalMs(now)`가 KST 시각을 보고 60초/120초/중단을 정한다. 테스트가 "하루 호출 수 < 1,000"을 고정해서, 나중에 간격을 줄이면 테스트가 먼저 깨진다.
- **`process.loadEnvFile('.env')`** — Node 22 내장. 라이브러리 없이 `.env`를 읽는다. 배포 환경엔 파일이 없으니 실패하면 무시한다.
- **폴러는 죽으면 안 된다.** GBIS 실패는 `PollOnce`가 삼켜서 `failed`로 기록하고, DB 실패는 `PollerService`가 로그만 찍고 다음 바퀴를 예약한다. 서버 프로세스가 죽는 유일한 경우는 우리가 모르는 버그뿐이어야 한다.
- **`/health`가 자랐다.** 노선별 마지막 폴 결과와 몇 초 전인지(`ageSec`)를 보여 준다. 7단계 배포 후 "폴러가 살아 있나"는 이걸로 본다.
- **하나 미룬 것**: `Clock`이 `now()`만 있고 시간대는 `pollIntervalMs`가 직접 KST로 계산한다. 서버 시각이 UTC여도 같은 순간이면 같은 답이 나오는지 테스트로 고정했다. 7단계에서 Render 로그의 시각이 UTC로 찍히는 걸 보며 이 결정을 다시 본다.

## 테스트는 어떻게 했나

| 층 | 무엇으로 | 검사 |
|---|---|---|
| domain (`schedule`) | 순수 함수 | KST 시간대별 간격, 하루 예산 < 1,000 |
| application (`PollOnce`) | 포트 전부 인메모리 가짜 | ok/empty/error/failed 4가지 결과가 각각 기록되는지 |
| infra (`PgObservationRepo`) | PGlite | 실제 녹화 응답 저장, 멱등, CHECK 위반 시 롤백 |
| infra (`PollerService`) | Vitest 가짜 타이머 | 겹침 없음, 새벽 중단, DB 실패에도 생존 |

application 테스트는 DB도 Nest도 없이 돈다. 이게 12-1의 "성공 기준"이었다.

## 실제로 돌린 결과 (2026-09-27 일요일 14:54 KST, 로컬에서 Neon으로)

```
[PollerService] 폴러 시작: routes=239000141
[PollerService] poll 239000141: ok    vehicles=1 inserted=1  89ms
[PollerService] poll 239000141: empty vehicles=0 inserted=0 124ms   ← 120초 뒤
```

Neon에 남은 것:

```
poll_run:            ok 14:54:12 (89ms) · empty 14:56:13 (124ms)
vehicle_observation: 경기77자6176  seq 30  passing  seats 26  relaxed  14:55:05
```

읽을 거리 셋.
- **같은 차량이다.** 9/11 밤에 seq 17을 출발하던 경기77자6176이 오늘 낮 seq 30(잠실 회차 직전)을 지나고 있다. 7002는 차량이 몇 대 없다.
- **2분 뒤엔 `empty`.** seq 30 다음이 회차 정류소(31)다. 회차하는 동안 GBIS 위치 목록에서 사라지는 것으로 보인다. "차량이 사라졌다 나타나는" 이상 징후(기획서 B-2의 `gap`)가 실제로 어떤 모양인지 첫 표본이 생겼다. 폴이 더 쌓이면 확인한다.
- **시각이 안 맞는다.** 폴이 끝난 시각은 14:54:12인데 관측의 `observed_at`(GBIS `queryTime`)은 14:55:05다. GBIS가 준 시각이 우리 시계보다 **53초 앞선다.** GBIS 서버 시계가 빠르거나, `queryTime`이 "요청 시각"이 아닌 다른 뜻이거나. 아직 이름을 붙이지 않는다. 폴이 며칠 쌓이면 이 차이가 일정한지 본다. 일정하면 시계 차이, 들쭉날쭉하면 다른 뜻이다.

## 직접 해보기

Neon에 002를 적용하고, 폴러를 켠 채로 서버를 띄운다. 운행시간(05~24시 KST)이어야 관측이 들어온다.

```bash
pnpm build && node --env-file=.env dist/scripts/migrate.js
```

```bash
POLL_ENABLED=true pnpm start:prod
```

다른 터미널에서 2~3분 뒤:

```bash
curl -s http://localhost:3000/health | python3 -m json.tool
```

`lastPoll` 아래 `239000141`에 `result: "ok"`와 `vehicles`가 보이면 된다. Neon SQL Editor에서:

```sql
SELECT plate_no, station_seq, state, remain_seats, observed_at AT TIME ZONE 'Asia/Seoul' AS kst
FROM vehicle_observation
WHERE route_id = 239000141
ORDER BY observed_at DESC
LIMIT 20;
```

`AT TIME ZONE 'Asia/Seoul'`은 저장은 UTC지만 **보여 줄 때만** KST로 바꾸는 것이다. 서버를 끄려면 `Ctrl+C`.
