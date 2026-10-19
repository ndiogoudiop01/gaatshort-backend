export const CONSENT_FACADE = Symbol('CONSENT_FACADE');

export type ConsentSubjectType = 'USER' | 'APPLICATION' | 'SUBSCRIBER' | 'PARTNER_LEAD';

export interface ConsentFacade {
  hasGrantedRequired(subjectType: ConsentSubjectType, subjectId: string): Promise<boolean>;
  record(params: {
    subjectType: ConsentSubjectType;
    subjectId: string;
    consents: { key: string; granted: boolean }[];
    ipHash?: string;
    userAgent?: string;
  }): Promise<void>;
  /** US-IG-028 — le partage aux partenaires est un consentement DISTINCT. */
  canShareWithPartners(subjectType: ConsentSubjectType, subjectId: string): Promise<boolean>;
}
