# 01. `GET /health` — 요청 하나가 지나가는 길

날짜: 2026-09-10 · 커밋: `feat: add GET /health`

## 만든 것

```
GET http://localhost:3000/health  →  200  {"ok":true,"now":"2026-09-10T14:39:10.415Z"}
GET http://localhost:3000/        →  404
```

파일 셋을 고쳤다: [src/app.controller.ts](../../src/app.controller.ts) · [src/app.service.ts](../../src/app.service.ts) · (등록은 이미 돼 있던) [src/app.module.ts](../../src/app.module.ts).

## 요청이 지나가는 길

```
브라우저/curl
  │  "GET /health 주세요"
  ▼
포트 3000에서 듣고 있던 Node 프로세스 (main.ts의 app.listen)
  │  Nest가 URL을 보고 어느 Controller의 어느 메서드인지 찾는다
  ▼
AppController.health()          ← @Get('health')가 붙은 메서드
  │  자기는 아무것도 안 하고 Service를 부른다
  ▼
AppService.health()             ← 진짜 일. 지금은 { ok, now } 만들기
  │  객체를 return
  ▼
Nest가 객체를 JSON 문자열로 바꾸고 200을 붙여 돌려준다
```

프론트로 치면: URL이 바뀌면 React Router가 `path`가 맞는 컴포넌트를 찾아 렌더하는 것과 같다. 다만 결과가 HTML이 아니라 JSON이고, "렌더"가 아니라 "return"이다.

## 개념 1 — Controller · Service · Module

| 파일 | 역할 | 프론트로 치면 |
|---|---|---|
| Controller | URL ↔ 메서드 연결. **얇게** | 라우트에 붙은 페이지 컴포넌트 |
| Service | 실제 일. 나중에 DB 읽기·GBIS 호출이 다 여기로 | 그 컴포넌트가 부르는 훅·함수 |
| Module | "이 Controller가 있고 이 Service를 쓸 수 있다"고 등록 | 앱 루트의 Provider 트리 |

`@Controller()`, `@Get('health')`, `@Injectable()`, `@Module({...})` 같은 `@` 붙은 것은 **데코레이터**다. 클래스나 메서드에 "이건 이런 역할이야"라고 라벨을 붙이는 문법이다. Nest는 실행될 때 이 라벨들을 읽어서 배선을 한다. 지금은 "Nest가 읽는 라벨"로만 알면 된다.

## 개념 2 — 의존성 주입 (DI)

```ts
constructor(private readonly appService: AppService) {}
```

`new AppService()`를 어디서도 하지 않았는데 `this.appService`가 있다. Module에 `providers: [AppService]`라고 등록해 두면, Nest가 Controller를 만들 때 생성자 파라미터의 **타입을 보고** 인스턴스를 넣어 준다.

프론트로 치면 `useContext`. 값을 직접 만들지 않고 위(Provider)에서 내려받는다. 좋은 점도 같다 — 테스트할 때 진짜 대신 가짜를 넣을 수 있다. 5단계에서 DB Service를 가짜로 바꿔 끼울 때 이게 왜 중요한지 몸으로 알게 된다.

## 테스트가 둘인 이유

| 파일 | 뭘 검사 | 서버를 띄우나 |
|---|---|---|
| `src/app.controller.spec.ts` | Controller 메서드를 직접 호출해 반환값 검사 | 아니오 |
| `test/app.e2e-spec.ts` | 진짜 HTTP 요청을 보내 상태코드·JSON 검사 (`supertest`) | 메모리 안에서 띄움 |

프론트로 치면 앞은 훅 단위 테스트, 뒤는 컴포넌트를 렌더해서 클릭해 보는 것. 지금은 둘 다 사실상 같은 걸 검사하지만, DB가 붙으면 갈라진다.

## 눈에 띈 것 (아직 개념 아님)

`now`가 `14:39Z`인데 한국은 23:39였다. `Z`는 UTC라는 뜻. 서버는 시간대 없이 UTC로 돈다. **7단계 배포에서 "운행시간대 판정"이 틀리는 형태로 다시 만난다.** 오늘은 여기까지.

## 직접 해보기

```bash
pnpm start:dev
```

다른 터미널에서:

```bash
curl -s http://localhost:3000/health | python3 -c "import sys,json; print(json.load(sys.stdin)['now'])"
```

`curl`은 터미널용 브라우저다. `-s`는 진행바 끄기. `|` 뒤는 받은 JSON에서 `now`만 꺼내는 파이썬 한 줄.
