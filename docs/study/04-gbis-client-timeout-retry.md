# 04. GBIS 클라이언트 — 타임아웃과 재시도

날짜: 2026-09-11 · 파일: [src/infra/gbis/gbis-client.ts](../../src/infra/gbis/gbis-client.ts) · [src/domain/ports.ts](../../src/domain/ports.ts) · [src/scripts/gbis-smoke.ts](../../src/scripts/gbis-smoke.ts)

## 만든 것

처음으로 **진짜 바깥**에 나가는 코드. `.env`의 키를 읽어 GBIS를 `fetch`하고, 받은 JSON을 3단계 파서에 넘긴다.

```
HttpGbisClient.fetchLocations(239000141)
  → fetch("https://apis.data.go.kr/6410000/buslocationservice/v2/getBusLocationListv2?serviceKey=…&routeId=239000141&format=json")
  → res.json()
  → parseLocations()        ← 3단계에서 만든 것
  → GbisResult<VehicleObservation>
```

`src/infra/`에 있다. `src/domain/`은 여전히 `fetch`를 모른다.

## 개념 1 — 타임아웃

프론트에서 `fetch`가 안 돌아오면 스피너가 돌다가 사용자가 새로고침한다. 서버엔 새로고침할 사람이 없다. 60초마다 도는 폴러가 응답을 영원히 기다리면, 다음 틱이 또 기다리고, 그다음도 기다리고… 기다리는 요청이 쌓이다 서버가 죽는다.

그래서 **모든 바깥 호출에는 "몇 초까지만 기다린다"가 붙어야 한다.** 예외 없다.

```ts
fetch(url, { signal: AbortSignal.timeout(5_000) })
```

프론트로 치면 `AbortController`로 이전 요청을 취소하던 그것인데, 이유가 "사용자가 딴 데 갔다"가 아니라 "기다리는 것 자체가 위험하다"로 바뀐다. 5초는 GBIS가 보통 1초 안에 답하는 걸 보고 정한 여유값이다.

## 개념 2 — 재시도와 지수 백오프

바깥 서비스는 가끔 실패한다. 네트워크가 한 번 튀거나, GBIS가 잠깐 500을 낸다. 한 번 실패했다고 그 틱을 버리면 60초 구멍이 생긴다. 그래서 **조금 기다렸다 다시** 한다.

| 실패 종류 | 다시 하나 | 이유 |
|---|---|---|
| 타임아웃 · 네트워크 오류 | 예 | 일시적일 가능성이 높다 |
| HTTP 5xx | 예 | 상대 서버 문제. 잠시 뒤엔 될 수 있다 |
| HTTP 4xx | **아니오** | 내 요청이 틀렸다(키·파라미터). 다시 보내도 똑같다 |
| HTTP 200인데 본문 `resultCode`가 30·22 | **아니오** | 키 미등록·한도 초과. 재시도하면 한도만 더 깎인다. `error` 결과로 돌려준다 |

간격은 500ms → 1000ms → 2000ms. 실패할수록 더 오래 기다리는 걸 **지수 백오프**라 한다. 상대가 아파서 실패하는 건데 곧바로 또 두드리면 더 아프게 한다. 총 3번까지만 하고 그래도 안 되면 `GbisHttpError`를 던진다.

프론트로 치면 React Query의 `retry: 3`, `retryDelay: exponential`이 하던 걸 직접 쓴 것이다. 이제 그 옵션이 뭘 하는지 안다.

**여기서 안 만든 것**: 서킷브레이커(연속 실패가 쌓이면 잠시 아예 안 부름). 폴러가 생기고 실제로 연속 실패를 겪으면 그때 붙인다.

## 테스트는 어떻게 했나

진짜 GBIS를 부르지 않는다. `fetch`와 `sleep`을 생성자로 **주입**받게 해서, 테스트에선 "첫 번째는 타임아웃, 두 번째는 성공"처럼 미리 짜 둔 가짜를 넣는다. `sleep`도 가짜라 500ms를 실제로 기다리지 않고 "500을 기다리려 했다"만 기록한다. 테스트 7개가 0.1초에 끝난다.

1단계에서 본 DI가 여기서 이유를 갖는다. `new` 대신 밖에서 넣어 주니까 바꿔 끼울 수 있다.

## 주의: 키는 URL에 그대로 붙인다

공공데이터포털 "Encoding 키"는 이미 URL 인코딩이 돼 있다(끝이 `%3D%3D`). `URLSearchParams`에 넣으면 `%`가 다시 인코딩돼 `%253D%253D`가 되고, GBIS는 키를 못 알아본다(에러 30). 그래서 문자열로 직접 이어 붙인다. 테스트 첫 번째가 이걸 지킨다.

## 덤: `domain/ports.ts`

`GbisPort`라는 인터페이스가 생겼다. domain은 "이런 메서드 3개가 있는 무언가"만 알고, 진짜 HTTP 클라이언트는 infra에 있다. 5단계에서 DB용 port를 만들 때 이 구조가 왜 좋은지 제대로 만난다. 지금은 "인터페이스는 domain, 구현은 infra"만.

## 살아 있는 응답이 알려 준 것 (2026-09-11 23:00 KST, 7002)

```
routeId=239000141  (175ms, 호출 3건)
  stations : ok, 61개
  line     : ok, 1512개
  locations: ok, 1개
    경기77자6176  seq  17  departed  seats 44  2026-09-11T13:59:38.213Z
```

첫 실행은 403이었다. `.env`에 진짜 키 대신 자리표시 글자가 들어가 있었고, 클라이언트는 "4xx는 재시도 안 함" 규칙대로 1번 만에 멈췄다(`attempts: 1`). 표가 첫 실전에서 확인됐다.

두 번째 실행에서 파서가 살아 있는 응답을 통과했다. 그리고 fixture로 저장한 원본을 열어 보니 **가정 하나가 틀려 있었다.**

| 예상 | 실제 | 조치 |
|---|---|---|
| `busLocationList`는 배열 | 결과 1건이라 **객체 하나** | 3단계에서 넣어 둔 "객체면 배열로" 보정이 바로 쓰임 |
| `crowded`는 `'Y'/'N'` | **숫자 1** (1 여유 · 2 보통 · 3 혼잡 · 4 매우혼잡) | `crowded: boolean` → `crowding: 'relaxed' \| 'normal' \| 'crowded' \| 'very_crowded'` 로 타입 수정. 빈 좌석 44에 1이니 1 = 여유 |
| `lowPlate`는 `'Y'/'N'` | 숫자 0/1 | 헬퍼가 이미 0/1도 받아서 그대로 |

이게 3단계 노트에서 말한 "fixture는 녹화 시점의 스냅샷이고, 살아 있는 응답으로 확인해야 한다"의 실제 사례다. 문서만 믿고 만든 타입은 틀릴 수 있고, **틀린 걸 알려 주는 건 실제 데이터로 도는 테스트뿐**이다. 이 원본은 `fixtures/gbis/locations-7002.json`으로 남겨 계약 테스트에 넣었다.

## 직접 해보기 — 살아 있는 응답으로

키를 `.env`에 넣는다 (이 파일은 `.gitignore`에 있어 커밋되지 않는다):

```bash
echo 'GBIS_SERVICE_KEY=여기에_Encoding_키' > .env
```

7002번을 한 번 호출해 본다. 운행시간이면 차량 목록이 찍힌다. `--record`는 위치 응답 원본을 `fixtures/gbis/locations-7002.json`으로 저장한다(호출 4건 사용):

```bash
pnpm build && node --env-file=.env dist/scripts/gbis-smoke.js 239000141 --record
```

`--env-file`은 Node 22가 `.env`를 직접 읽는 옵션이라 라이브러리가 필요 없다.
