import { AggregateRoot } from '@shared/kernel/domain/aggregate-root';
import { DomainEvent } from '@shared/kernel/domain/domain-event';
import { Entity } from '@shared/kernel/domain/entity';
import { Identifier } from '@shared/kernel/domain/identifier';
import { ValueObject } from '@shared/kernel/domain/value-object';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';
const OTHER_UUID = '22222222-2222-4222-8222-222222222222';

class TestId extends Identifier<'Test'> {
  public static create(value: string): TestId {
    return new TestId(value);
  }
}

class TestEntity extends Entity<TestId> {
  public static create(id: TestId): TestEntity {
    return new TestEntity(id);
  }
}

interface CoordsProps extends Record<string, unknown> {
  readonly lat: number;
  readonly lng: number;
}

class Coords extends ValueObject<CoordsProps> {
  public static of(lat: number, lng: number): Coords {
    return new Coords({ lat, lng });
  }
  public get lat(): number {
    return this.props.lat;
  }
}

class TestEvent extends DomainEvent {
  constructor(tenantId: string, aggregateId: string, metadata?: { actorId?: string }) {
    super(tenantId, aggregateId, metadata);
  }
  public get eventName(): string {
    return 'test.happened';
  }
  public get aggregateType(): string {
    return 'Test';
  }
  public payload(): Record<string, unknown> {
    return {};
  }
}

class TestAggregate extends AggregateRoot<TestId> {
  public static create(id: TestId): TestAggregate {
    return new TestAggregate(id);
  }
  public doSomething(): void {
    this.record(new TestEvent('tenant-1', this.id.value));
  }
}

describe('Identifier', () => {
  it('accepte un UUID valide', () => {
    expect(() => TestId.create(VALID_UUID)).not.toThrow();
  });

  it('refuse une valeur qui n’est pas un UUID', () => {
    expect(() => TestId.create('not-a-uuid')).toThrow(/[Ii]nvalide/);
  });

  it('génère des UUID valides', () => {
    expect(Identifier.isUuid(Identifier.generate())).toBe(true);
  });

  it('compare deux identifiants par valeur', () => {
    const a = TestId.create(VALID_UUID);
    const b = TestId.create(VALID_UUID);
    const c = TestId.create(OTHER_UUID);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
    expect(a.equals(undefined)).toBe(false);
  });

  it('se sérialise en chaîne et en JSON', () => {
    const id = TestId.create(VALID_UUID);
    expect(id.toString()).toBe(VALID_UUID);
    expect(id.toJSON()).toBe(VALID_UUID);
    expect(JSON.stringify({ id })).toBe(`{"id":"${VALID_UUID}"}`);
  });
});

describe('Entity', () => {
  it('deux entités sont égales si leurs identifiants le sont', () => {
    const a = TestEntity.create(TestId.create(VALID_UUID));
    const b = TestEntity.create(TestId.create(VALID_UUID));
    expect(a.equals(b)).toBe(true);
    expect(a.equals(a)).toBe(true);
    expect(a.equals(undefined)).toBe(false);
  });

  it('deux entités avec des identifiants différents ne sont pas égales', () => {
    const a = TestEntity.create(TestId.create(VALID_UUID));
    const b = TestEntity.create(TestId.create(OTHER_UUID));
    expect(a.equals(b)).toBe(false);
  });
});

describe('ValueObject', () => {
  it('deux value objects avec les mêmes props sont égaux', () => {
    expect(Coords.of(1, 2).equals(Coords.of(1, 2))).toBe(true);
  });

  it('deux value objects avec des props différentes ne sont pas égaux', () => {
    expect(Coords.of(1, 2).equals(Coords.of(1, 3))).toBe(false);
  });

  it('n’est jamais égal à undefined ou à un autre type', () => {
    const coords = Coords.of(1, 2);
    expect(coords.equals(undefined)).toBe(false);
  });

  it('gèle ses props pour garantir l’immuabilité', () => {
    const coords = Coords.of(1, 2);
    expect(Object.isFrozen((coords as unknown as { props: unknown }).props)).toBe(true);
  });
});

describe('AggregateRoot', () => {
  it('accumule puis vide les événements de domaine', () => {
    const aggregate = TestAggregate.create(TestId.create(VALID_UUID));
    aggregate.doSomething();
    expect(aggregate.domainEvents).toHaveLength(1);

    const pulled = aggregate.pullDomainEvents();
    expect(pulled).toHaveLength(1);
    expect(pulled[0].eventName).toBe('test.happened');
    expect(aggregate.domainEvents).toHaveLength(0);
  });
});

describe('DomainEvent', () => {
  it('porte un identifiant, un tenant et un horodatage propres', () => {
    const event = new TestEvent('tenant-1', 'agg-1', { actorId: 'user-1' });
    expect(event.tenantId).toBe('tenant-1');
    expect(event.aggregateId).toBe('agg-1');
    expect(event.metadata.actorId).toBe('user-1');
    expect(event.occurredAt).toBeInstanceOf(Date);
    expect(event.eventId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
