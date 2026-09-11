# 03. 파서와 계약 테스트 — 바깥 세상의 JSON을 우리 타입으로

날짜: 2026-09-11 · 파일: [src/domain/gbis/](../../src/domain/gbis/) (`types.ts` · `parse.ts` · `parse.spec.ts`)

## 만든 것

GBIS 응답 JSON 3종(정류소·형상·위치)을 받아 **우리 타입**으로 바꾸는 순수 함수 3개. 그리고 녹화해 둔 실제 응답(`fixtures/gbis/*.json`)을 넣어 돌리는 테스트 17개.

```
fixtures/gbis/stations-7000.json ──▶ parseStations() ──▶ { kind: 'ok', items: RouteStation[101] }
fixtures/gbis/line-7000.json     ──▶ parseLine()     ──▶ { kind: 'ok', items: ShapePoint[2487] }
(위치 fixture는 2단계에서 녹화)   ──▶ parseLocations()──▶ { kind: 'ok', items: VehicleObservation[] }
```

Nest도 DB도 네트워크도 안 썼다. `pnpm test`가 0.4초에 끝난다.

## 개념 1 — 경계에서 파싱한다

프론트에서 `fetch` 결과를 `as MyType`으로 단언하고 그냥 쓰는 일이 많다. 그건 "API가 내가 생각한 모양일 것"이라는 **믿음**이고, 틀리면 화면 깊숙한 곳에서 `undefined is not a function`으로 터진다.

서버는 24시간 돌고 GBIS는 남의 시스템이다. 그래서 **들어오는 지점 한 곳**에서 모양을 검사하고, 그 뒤로는 우리 타입만 돌아다니게 한다.

- 숫자여야 할 자리에 문자열이 오면 `GbisParseError`를 **즉시** 던진다. 조용히 넘어가면 나중에 DB에 이상한 값이 쌓인다.
- 결과가 1건일 때 배열 대신 객체를 주는 공공 API 버릇을 여기서 배열로 맞춘다. 이 뒤의 코드는 그 버릇을 몰라도 된다.
- `queryTime: "2026-09-03 00:36:49.450"`은 시간대 표기가 없는 **KST** 문자열이다. 여기서 `+09:00`을 붙여 `Date`로 만든다. 이 뒤의 코드는 전부 UTC `Date`만 본다. (7단계에서 이 결정 덕을 본다)
- `stateCd: 0/1/2` 같은 숫자 코드는 `'passing' | 'arrived' | 'departed'`로 이름을 붙인다. 이 뒤의 코드에 `=== 2`가 안 나온다.

프론트로 치면: 폼 입력을 화면 곳곳에서 검사하지 않고 제출 지점에서 zod로 한 번 검사하는 것. 검사 위치가 **한 곳**이라는 게 핵심이다.

반환 타입은 이미 아는 Discriminated Union이다.

```ts
type GbisResult<T> =
  | { kind: 'ok'; queryTime: Date; items: T[] }
  | { kind: 'empty'; queryTime: Date }        // resultCode 4: 정상이지만 결과 없음 (새벽)
  | { kind: 'error'; code: number; message: string };  // 30 키 미등록, 22 한도 초과 …
```

"결과 없음"과 "에러"를 구분하는 게 중요하다. 새벽엔 `empty`가 정상이고, `error` 22가 오면 자정까지 폴링을 멈춰야 한다(6단계).

## 개념 2 — 계약 테스트

`parse.spec.ts`는 함수에 가짜 값을 넣는 단위 테스트가 아니라, **실제 GBIS가 준 응답 파일**을 넣는다. 그래서 검사하는 건 "내 코드가 맞나"보다 **"GBIS와 내 코드 사이의 약속이 아직 유효한가"** 다.

- 7000 정류소 101개, 회차 정류소는 정확히 하나이고 그 seq가 52
- 형상 2,487점, 왕복이라 첫 점과 끝 점이 50m 안
- 모든 좌표가 경기도 범위(경도 126~128, 위도 37~38)

이 숫자들은 기획서 §2-5에서 실측한 값이다. GBIS가 필드명을 바꾸거나 노선을 개편하면 **여기서 먼저 깨진다.** 그게 이 테스트의 존재 이유다.

프론트로 치면: MSW 핸들러에 실제 응답을 복붙해 두던 것과 같은 재료인데, 용도가 반대다. MSW는 "API가 이렇다고 치고 화면을 테스트", 계약 테스트는 "API가 정말 이런지를 테스트".

fixture의 한계도 적어 둔다. 녹화 시점(09-03)의 스냅샷이라, GBIS가 **오늘** 바뀌었는지는 모른다. 그건 4단계에서 실제 호출을 붙였을 때 같은 파서가 살아 있는 응답을 받아 보며 확인한다.

## 왜 `src/domain/`인가

이 폴더는 Nest를 모른다(`grep -rn "@nestjs" src/domain` → 0). 그래서

1. 테스트가 서버를 안 띄우고 돈다 (0.4초)
2. 나중에 이 폴더를 통째로 npm 패키지로 빼서 프론트에서도 같은 타입·파서를 쓸 수 있다
3. `infra/`만 다른 프레임워크로 바꿔도 이 폴더는 그대로다

## 직접 해보기

```bash
pnpm test
```

테스트 하나를 일부러 깨 보면 계약 테스트가 뭘 지키는지 몸으로 안다. `fixtures/gbis/stations-7000.json`에서 정류소 하나를 지우고 다시 돌려 보자. 확인했으면 `git checkout fixtures/`로 되돌린다.
