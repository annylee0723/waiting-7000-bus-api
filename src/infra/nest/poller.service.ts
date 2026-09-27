import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { PollOnce, PollSummary } from '../../application/poll-once.js';
import type { Clock } from '../../domain/ports.js';
import { pollIntervalMs } from '../../domain/budget/schedule.js';

export const POLL_ONCE = Symbol('POLL_ONCE');
export const CLOCK = Symbol('CLOCK');
export const POLLER_CONFIG = Symbol('POLLER_CONFIG');

export type PollerConfig = { enabled: boolean; routeIds: number[] };

/** 운행시간 밖일 때 다시 확인하기까지 */
const OFF_HOURS_RECHECK_MS = 5 * 60_000;

/**
 * 폴러. "끝나면 다음을 예약" 방식이라 두 폴이 겹치지 않는다.
 * setInterval이었다면 GBIS가 70초 걸릴 때 다음 틱이 그 위에 올라탄다.
 */
@Injectable()
export class PollerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PollerService.name);
  private timer: NodeJS.Timeout | undefined;
  private inFlight = false;
  private stopped = false;
  /** 노선별 마지막 폴 결과 (메모리). /health가 읽는다 */
  readonly last = new Map<number, PollSummary>();

  constructor(
    @Inject(POLL_ONCE) private readonly pollOnce: PollOnce | null,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(POLLER_CONFIG) private readonly config: PollerConfig,
  ) {}

  onModuleInit(): void {
    if (!this.config.enabled) {
      this.log.log('폴러 꺼짐 (POLL_ENABLED != true)');
      return;
    }
    if (!this.pollOnce) {
      this.log.warn('폴러 켜졌지만 DATABASE_URL 없음 → 폴링하지 않음');
      return;
    }
    this.log.log(`폴러 시작: routes=${this.config.routeIds.join(',')}`);
    void this.tick();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** 한 바퀴: 지금 폴링할 시간대인지 보고, 맞으면 노선마다 한 번씩 폴하고, 다음 바퀴를 예약 */
  async tick(): Promise<void> {
    if (this.stopped || !this.pollOnce) return;
    const interval = pollIntervalMs(this.clock.now());
    if (interval === null) {
      this.schedule(OFF_HOURS_RECHECK_MS);
      return;
    }
    if (this.inFlight) return; // 수동 호출 등으로 겹칠 때의 안전장치
    this.inFlight = true;
    try {
      for (const routeId of this.config.routeIds) {
        const s = await this.pollOnce.run(routeId);
        this.last.set(routeId, s);
        const took = s.finishedAt.getTime() - s.startedAt.getTime();
        this.log.log(
          `poll ${routeId}: ${s.result} vehicles=${s.vehicles} inserted=${s.inserted} ${took}ms${s.detail ? ` (${s.detail})` : ''}`,
        );
      }
    } catch (e) {
      // PollOnce는 GBIS 실패를 삼키므로 여기 오는 건 DB 저장 실패다. 폴러는 죽지 않고 다음 바퀴로
      this.log.error(
        `poll 저장 실패: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      this.inFlight = false;
    }
    this.schedule(interval);
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), ms);
    this.timer.unref?.(); // 테스트·종료 시 이 타이머가 프로세스를 붙잡지 않게
  }
}
