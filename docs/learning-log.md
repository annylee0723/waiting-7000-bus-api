# 학습 노트

처음 만나는 백엔드 개념을 만난 날짜순으로 적는다. 꾸미지 않는다.

| 날짜 | 만난 문제 | 이름 | Nest에서 | 프론트로 치면 |
|---|---|---|---|---|
| 2026-09-10 | `GET /health` 하나를 만드는 데 파일이 셋 필요했다 | Controller · Service · Module | `@Controller`가 URL을 받고, `@Injectable` Service가 일을 하고, `@Module`이 둘을 묶는다 | 라우트 컴포넌트 · 그 안에서 부르는 훅/함수 · 앱 루트의 Provider 트리 |
| 2026-09-10 | Controller가 Service를 `new` 하지 않는데 쓸 수 있다 | 의존성 주입(DI) | 생성자 파라미터 타입을 보고 Nest가 인스턴스를 넣어 준다 | `useContext` — 값을 직접 만들지 않고 위에서 내려받는다 |
