/** 우리가 다루는 노선. GBIS routeId ↔ 노선 번호 */
export const KNOWN_ROUTES: Record<number, string> = {
  239000139: '7000',
  239000140: '7001',
  239000141: '7002',
};
export const ROUTE_ID_BY_NO: Record<string, number> = Object.fromEntries(
  Object.entries(KNOWN_ROUTES).map(([id, no]) => [no, Number(id)]),
);
