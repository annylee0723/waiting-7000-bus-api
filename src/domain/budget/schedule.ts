// 순수 함수. 폴링 예산 정책 — 하루 1,000건 한도 안에서 언제 얼마나 자주 물을지.
// 서버는 UTC로 돌지만 운행시간은 KST 기준이므로, 시각을 KST 시(hour)로 바꿔 판단한다.

export const SEOUL = 'Asia/Seoul';

/** 주어진 시각의 KST 시(0~23) */
export function hourIn(date: Date, timeZone = SEOUL): number {
  const h = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hour12: false,
  }).format(date);
  return Number(h) % 24; // Intl은 자정을 '24'로 주기도 한다
}

/**
 * 다음 폴까지 간격(ms). null이면 지금은 폴링하지 않는 시간대.
 *   05~07  120초    (첫차 준비)
 *   07~09   60초    (출근)
 *   09~17  120초
 *   17~20   60초    (퇴근)
 *   20~24  120초
 *   00~05  중단
 * ≈ 5×30 + 5×60 + 8×30 + ... ≈ 하루 780건/노선. 한도 1,000의 안쪽.
 */
export function pollIntervalMs(now: Date, timeZone = SEOUL): number | null {
  const h = hourIn(now, timeZone);
  if (h < 5) return null;
  if ((h >= 7 && h < 9) || (h >= 17 && h < 20)) return 60_000;
  return 120_000;
}

/** 하루 예상 호출 수 (정책이 한도 안인지 테스트로 고정하기 위해) */
export function estimatedCallsPerDay(timeZone = SEOUL): number {
  let calls = 0;
  const base = new Date('2026-01-05T00:00:00+09:00'); // 임의의 하루 (KST 자정)
  for (let m = 0; m < 24 * 60; m++) {
    const t = new Date(base.getTime() + m * 60_000);
    const iv = pollIntervalMs(t, timeZone);
    if (iv !== null) calls += 60_000 / iv;
  }
  return Math.round(calls);
}
