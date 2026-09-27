-- 002: 폴링 결과. 두 표 다 append-only — 행을 고치지 않고 늘 새로 추가한다.

-- 폴 한 번 = 한 행. "폴러가 살아 있나, 언제 뭘 받았나"를 여기서 본다.
CREATE TABLE poll_run (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  route_id    integer NOT NULL REFERENCES route (id),
  started_at  timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  result      text NOT NULL CHECK (result IN ('ok', 'empty', 'error', 'failed')),
              -- ok: 차량 있음 · empty: 결과 없음(새벽) · error: GBIS resultCode 오류 · failed: HTTP/파싱 실패
  vehicles    integer NOT NULL DEFAULT 0,   -- 응답에 있던 차량 수
  inserted    integer NOT NULL DEFAULT 0,   -- 실제로 새로 저장된 행 수 (중복이면 vehicles보다 작다)
  detail      text                          -- 오류 메시지 등
);

-- 관측 한 건 = 한 행. GPS 없음: 정류소 순번과 상태가 전부다.
CREATE TABLE vehicle_observation (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  route_id     integer NOT NULL REFERENCES route (id),
  plate_no     text    NOT NULL,
  station_id   integer NOT NULL,            -- FK 없음: GBIS가 우리 목록에 없는 정류소를 줘도 폴이 실패하면 안 된다
  station_seq  integer NOT NULL,
  state        text    NOT NULL CHECK (state IN ('passing', 'arrived', 'departed')),
  remain_seats integer,
  crowding     text,
  low_floor    boolean,
  observed_at  timestamptz NOT NULL,        -- GBIS queryTime (UTC로 저장)
  -- 같은 차량의 같은 시각 관측은 하나뿐. 같은 응답을 두 번 저장해도 행이 안 는다 (멱등)
  UNIQUE (route_id, plate_no, observed_at)
);

-- "이 노선의 어느 기간 관측"을 빨리 찾기 위한 인덱스. (UNIQUE가 만든 인덱스는 plate_no 순이라 기간 검색엔 못 쓴다)
CREATE INDEX vehicle_observation_route_time ON vehicle_observation (route_id, observed_at);
