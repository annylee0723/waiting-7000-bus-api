# 기술 스택 — 무엇을, 왜

2026-10-12 정리. 사용자 질문 "지금 스택이 뭐고 왜 Java·Spring 대신인가"에 대한 답.

| 층 | 선택 | 한 줄 이유 | 대안이었던 것 |
|---|---|---|---|
| 언어 | TypeScript (Node 22) | 프론트와 같은 언어. 타입·테스트·도구를 이미 안다 | Java, Python |
| 서버 프레임워크 | NestJS 12 | 네이버랩스 JD 필수 "NestJS 또는 동급 Node.js 서버 프레임워크" | Express(부트캠프 때 씀), Spring |
| DB | PostgreSQL (Neon 무료) | 관계형 DB의 표준. 무료 호스팅. SQL이 그대로 보인다 | SQLite, MongoDB |
| DB 접근 | `pg` 드라이버 + SQL 직접 | ORM이 가리는 층(인덱스·트랜잭션·EXPLAIN)이 정확히 배우려는 층 | Prisma(부트캠프), Kysely(원안) |
| 마이그레이션 | SQL 파일 + 직접 쓴 러너 40줄 | 도구를 하나 더 배우는 것보다 원리가 보이는 게 낫다 | prisma migrate, node-pg-migrate |
| 테스트 | Vitest + PGlite | 프론트와 같은 러너. DB 테스트는 서버 없이 WASM Postgres로 | Jest, testcontainers |
| 외부 API | `fetch` + 직접 쓴 타임아웃·재시도 | 라이브러리가 해 주면 재시도가 뭔지 안 보인다 | axios + axios-retry |
| 구조 | domain / application / infra | Nest를 가장자리에만. 프레임워크와 문제를 분리 | Nest 기본 구조(모듈마다 controller·service) |
| 실시간 (8단계) | SSE | 단방향·재연결 내장. 30~60초 주기엔 WebSocket이 과하다 | WebSocket, 폴링 |
| 호스팅 | Render 무료 + cron-job.org + Vercel(프론트) | 전부 무료 | Fly.io, Railway(유료) |

## 왜 Java·Spring이 아닌가

1. **목표 회사가 Node를 원한다.** 네이버랩스 프론트엔드 JD가 NestJS를 필수로 적었다. Spring은 백엔드 전담 공고의 언어다. 프론트 개발자에게 "서버도 만져 봤나"를 묻는 자리의 답은 Node다.
2. **배우는 양을 한 축으로 줄였다.** Spring이면 언어(Java)·빌드(Gradle)·프레임워크·JVM 운영을 동시에 새로 배운다. 지금은 언어는 아는 채로 "서버란 무엇인가"만 새로 배운다. 타임아웃·재진입·트랜잭션·인덱스는 언어와 무관한데, 언어까지 새로우면 그 개념이 문법에 묻힌다.
3. **옮길 수 있게 만들었다.** `domain/`·`application/`엔 Nest가 없다. 기획서 §12-4의 최종 시험은 `infra/`만 Spring이나 FastAPI로 다시 써서 **같은 테스트를 통과**시키는 것이다. 그러면 "Spring 안 써 봤다"가 아니라 "같은 설계를 두 프레임워크로 만들었다"가 된다.

## 면접에서

"왜 Spring 안 했어요?" →
> 프레임워크가 가려 주는 문제를 먼저 이름으로 알고 싶어서 Nest를 가장자리에만 뒀습니다. 재진입 방지를 in-flight 플래그로 막았는데 Spring이면 ShedLock이 같은 역할이고, 트랜잭션 경계는 유스케이스 단위로 잡았는데 그건 어디서든 같습니다.

지금까지 만든 것만으로 이 문장은 거짓이 아니다.

## 부트캠프와의 차이

코드잇에서 한 것은 **Express + Prisma** 한 번. NestJS는 이 프로젝트가 처음이다. Express와 Nest의 차이는 "구조를 강제하느냐"다. Express는 라우트 하나를 한 줄로 만들 수 있고 그래서 처음엔 쉽지만, 파일이 늘면 어디에 뭘 둘지 매번 정해야 한다. Nest는 Controller·Service·Module로 자리를 정해 준다. 처음 배울 땐 그 강제가 길잡이가 된다.
