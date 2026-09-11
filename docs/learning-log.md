# 학습 노트

처음 만나는 백엔드 개념을 만난 날짜순으로 적는다. 꾸미지 않는다.

| 날짜 | 만난 문제 | 이름 | Nest에서 | 프론트로 치면 |
|---|---|---|---|---|
| 2026-09-10 | `GET /health` 하나를 만드는 데 파일이 셋 필요했다 | Controller · Service · Module | `@Controller`가 URL을 받고, `@Injectable` Service가 일을 하고, `@Module`이 둘을 묶는다 | 라우트 컴포넌트 · 그 안에서 부르는 훅/함수 · 앱 루트의 Provider 트리 |
| 2026-09-10 | Controller가 Service를 `new` 하지 않는데 쓸 수 있다 | 의존성 주입(DI) | 생성자 파라미터 타입을 보고 Nest가 인스턴스를 넣어 준다 | `useContext` — 값을 직접 만들지 않고 위에서 내려받는다 |
| 2026-09-11 | GBIS JSON을 `as` 단언으로 쓰면 틀린 모양이 DB까지 흘러간다 | 경계에서 파싱 | `src/domain/gbis/parse.ts`에서 필드 검사 + KST→UTC + 코드→이름, 틀리면 즉시 throw | zod를 제출 지점 한 곳에서만 |
| 2026-09-11 | "내 코드가 맞나"가 아니라 "GBIS와의 약속이 아직 유효한가"를 검사해야 한다 | 계약 테스트 | 녹화된 실제 응답(fixture)을 파서에 넣는 spec 17개 | MSW 핸들러의 반대 방향 |
