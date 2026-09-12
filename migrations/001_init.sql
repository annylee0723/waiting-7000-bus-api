-- 001: 노선·정류소·형상. 폴링 전에 한 번 적재하는 "거의 안 변하는" 표들.
-- id는 GBIS가 주는 9자리 숫자라 integer(최대 21억)로 충분하다.
-- (bigint로 하면 pg 드라이버가 문자열로 돌려줘서 귀찮아진다)

CREATE TABLE route (
  id        integer PRIMARY KEY,               -- GBIS routeId (예: 239000141)
  route_no  text    NOT NULL,                  -- '7002'
  name      text    NOT NULL,                  -- '유명산종점 ↔ 잠실역.롯데월드'
  turn_seq  integer,                           -- 회차 순번. 방향별 routeId(P7001)면 NULL
  loaded_at timestamptz NOT NULL DEFAULT now() -- 마지막 적재 시각 (UTC)
);

CREATE TABLE station (
  id   integer PRIMARY KEY,                    -- GBIS stationId. 방향별로 id가 다르다 (윗벌 239000859 / 239000860)
  name text NOT NULL,
  lng  double precision NOT NULL,              -- GBIS x
  lat  double precision NOT NULL               -- GBIS y
);

-- "이 노선의 N번째 정류소는 어느 정류소인가". 정류소 자체와 순번을 분리한다.
CREATE TABLE route_station (
  route_id   integer NOT NULL REFERENCES route (id),
  seq        integer NOT NULL,
  station_id integer NOT NULL REFERENCES station (id),
  PRIMARY KEY (route_id, seq)
);

-- 노선 형상(폴리라인). cum_dist_m은 출발점부터의 누적 거리(m)로, 위치 보간에 쓴다.
CREATE TABLE route_shape (
  route_id   integer NOT NULL REFERENCES route (id),
  seq        integer NOT NULL,
  lng        double precision NOT NULL,
  lat        double precision NOT NULL,
  cum_dist_m double precision NOT NULL,
  PRIMARY KEY (route_id, seq)
);
