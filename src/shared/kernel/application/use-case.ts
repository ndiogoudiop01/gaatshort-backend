/**
 * Un cas d'usage = une intention métier = une classe.
 * Interface Segregation : le contrôleur dépend d'un `UseCase<In, Out>`,
 * pas d'un service fourre-tout à quinze méthodes.
 */
export interface UseCase<TInput, TOutput> {
  execute(input: TInput): Promise<TOutput>;
}

/** Marqueur : mute l'état, s'exécute sur le primaire, publie des événements. */
export interface Command {
  readonly __command?: never;
}

/** Marqueur : lecture pure, éligible au cache et à la réplique de lecture. */
export interface Query {
  readonly __query?: never;
}
