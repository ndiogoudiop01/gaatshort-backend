import { effectiveAccess, effectiveFreeEpisodes, isLicensed, slugify } from '../domain/services/episode-access';

const SERIES = { freeEpisodes: 5, episodePriceCoins: 15 };

describe('Accès aux épisodes (D-05, D-06)', () => {
  it('les 5 premiers épisodes sont gratuits, les suivants au prix de la série', () => {
    expect(effectiveAccess(SERIES, { number: 5, priceCoinsOverride: null })).toEqual({ isFree: true, priceCoins: 0 });
    expect(effectiveAccess(SERIES, { number: 6, priceCoinsOverride: null })).toEqual({ isFree: false, priceCoins: 15 });
  });

  it('prix : surcharge de la marque > surcharge de l’épisode > prix de la série', () => {
    expect(effectiveAccess(SERIES, { number: 9, priceCoinsOverride: 25 })).toEqual({ isFree: false, priceCoins: 25 });
    expect(
      effectiveAccess(SERIES, { number: 9, priceCoinsOverride: 25 }, { freeEpisodesOverride: null, episodePriceCoinsOverride: 10 }),
    ).toEqual({ isFree: false, priceCoins: 10 });
  });

  it('la marque peut changer le nombre d’épisodes gratuits, jamais en dessous de zéro', () => {
    const t = { freeEpisodesOverride: 8, episodePriceCoinsOverride: null };
    expect(effectiveAccess(SERIES, { number: 8, priceCoinsOverride: null }, t).isFree).toBe(true);
    expect(effectiveFreeEpisodes(SERIES, { freeEpisodesOverride: -3, episodePriceCoinsOverride: null })).toBe(0);
    expect(effectiveFreeEpisodes(SERIES, null)).toBe(5);
  });

  it('un prix nul rend l’épisode gratuit (jamais de déblocage à 0 crédit)', () => {
    expect(effectiveAccess(SERIES, { number: 20, priceCoinsOverride: null }, { freeEpisodesOverride: null, episodePriceCoinsOverride: 0 }))
      .toEqual({ isFree: true, priceCoins: 0 });
  });
});

describe('Licences (R-02)', () => {
  const at = new Date('2027-01-01');
  const license = { startsAt: new Date('2026-01-01'), endsAt: new Date('2028-01-01'), territories: ['SN'], sublicensingAllowed: false };

  it('couvre le pays dans la période', () => {
    expect(isLicensed([license], 'SN', at, true)).toBe(true);
    expect(isLicensed([license], 'GM', at, true)).toBe(false);
    expect(isLicensed([license], 'SN', new Date('2029-01-01'), true)).toBe(false);
    expect(isLicensed([], 'SN', at, true)).toBe(false);
  });

  it('une marque tierce exige le droit de sous-licence', () => {
    expect(isLicensed([license], 'SN', at, false)).toBe(false);
    expect(isLicensed([{ ...license, sublicensingAllowed: true }], 'SN', at, false)).toBe(true);
  });
});

describe('slugify', () => {
  it('retire accents et ponctuation', () => {
    expect(slugify('  Le Pacte de Ngor : saison 2 !')).toBe('le-pacte-de-ngor-saison-2');
    expect(slugify('Mariage sous contrat — Épisode spécial')).toBe('mariage-sous-contrat-episode-special');
  });
});
