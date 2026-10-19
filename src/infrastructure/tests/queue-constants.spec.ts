import {
  DEFAULT_JOB_OPTIONS,
  JOBS,
  QUEUE_CONCURRENCY,
  QUEUE_PRIORITY,
  QUEUES,
} from '../queue/queue.constants';

describe('queue.constants', () => {
  const allQueues = Object.values(QUEUES);

  it('déclare une file par domaine de préoccupation, sans doublon', () => {
    expect(new Set(allQueues).size).toBe(allQueues.length);
    expect(new Set(Object.values(JOBS)).size).toBe(Object.values(JOBS).length);
  });

  it('applique un backoff EXPONENTIEL avec plusieurs tentatives (critère de retry)', () => {
    expect(DEFAULT_JOB_OPTIONS.attempts).toBeGreaterThan(1);
    expect(DEFAULT_JOB_OPTIONS.backoff.type).toBe('exponential');
    expect(DEFAULT_JOB_OPTIONS.backoff.delay).toBeGreaterThan(0);
    // On garde les échecs plus longtemps que les succès (post-mortem).
    expect(DEFAULT_JOB_OPTIONS.removeOnFail.age).toBeGreaterThan(
      DEFAULT_JOB_OPTIONS.removeOnComplete.age,
    );
  });

  it('donne à CHAQUE file une priorité et une concurrence (source unique)', () => {
    for (const q of allQueues) {
      expect(QUEUE_PRIORITY[q]).toEqual(expect.any(Number));
      expect(QUEUE_PRIORITY[q]).toBeGreaterThanOrEqual(1);
      expect(QUEUE_CONCURRENCY[q]).toEqual(expect.any(Number));
      expect(QUEUE_CONCURRENCY[q]).toBeGreaterThanOrEqual(1);
    }
    expect(Object.keys(QUEUE_PRIORITY).sort()).toEqual([...allQueues].sort());
    expect(Object.keys(QUEUE_CONCURRENCY).sort()).toEqual([...allQueues].sort());
  });

  it('ordonne le transactionnel avant le bulk', () => {
    // « un e-mail massif ne retarde jamais une notif transactionnelle »
    expect(QUEUE_PRIORITY[QUEUES.NOTIFICATIONS]).toBeLessThan(QUEUE_PRIORITY[QUEUES.EXPORTS]);
    expect(QUEUE_PRIORITY[QUEUES.OUTBOX]).toBeLessThan(QUEUE_PRIORITY[QUEUES.MAINTENANCE]);
    // Le relais outbox est sérialisé (verrou distribué en amont).
    expect(QUEUE_CONCURRENCY[QUEUES.OUTBOX]).toBe(1);
  });
});
