// 순수 함수. 지구를 반지름 6,371km 구로 보고 두 점 사이 거리(m)를 구한다 (haversine).
// 수십 km 범위에서 오차 0.5% 미만. 버스 위치 보간엔 충분하다.

export type LngLat = { lng: number; lat: number };

const R = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

export function haversineM(a: LngLat, b: LngLat): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** 점 목록의 누적 거리(m). 첫 점은 0. 길이는 입력과 같다 */
export function cumulativeDistancesM(points: readonly LngLat[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) acc += haversineM(points[i - 1]!, points[i]!);
    out.push(acc);
  }
  return out;
}
