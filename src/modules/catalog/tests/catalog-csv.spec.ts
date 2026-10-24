import { MAX_IMPORT_ROWS, parseCsv, planImport } from '../domain/services/catalog-csv';

const HEADER = 'series_slug,series_title,synopsis,genres,maturity_rating,release_year,free_episodes,episode_price_coins,poster_url,banner_url,episode_number,episode_title,episode_price_override,video_url';

describe('parseCsv', () => {
  it('guillemets, guillemets doublés, retours à la ligne et BOM', () => {
    expect(parseCsv('\uFEFFa,b\r\n"x, y","il dit ""oui""\nencore"\n\n')).toEqual([['a', 'b'], ['x, y', 'il dit "oui"\nencore']]);
  });

  it('détecte le point-virgule (Excel en français)', () => {
    expect(parseCsv('a;b;c\n1;2,5;3')).toEqual([['a', 'b', 'c'], ['1', '2,5', '3']]);
  });

  it('dernière ligne sans saut de ligne', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('planImport', () => {
  it('regroupe par série, lit les champs de série sur la première ligne, trie les épisodes', () => {
    const csv = [
      HEADER,
      ',Le Pacte de Ngor,Une vengeance.,Drame|romance|drame,16+,2026,3,20,https://cdn.test/p.jpg,,2,La fuite,,https://src.test/2.mp4',
      ',Le Pacte de Ngor,,,,,,,,,1,,,https://src.test/1.mp4',
      'autre-serie,Autre,,,,,,,,,1,,0,',
    ].join('\n');
    const { plans, errors, warnings } = planImport(csv);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(plans).toHaveLength(2);
    expect(plans[0].series).toEqual({
      slug: 'le-pacte-de-ngor', titleFr: 'Le Pacte de Ngor', synopsisFr: 'Une vengeance.', genreSlugs: ['drame', 'romance'],
      maturityRating: '16+', releaseYear: 2026, freeEpisodes: 3, episodePriceCoins: 20, posterUrl: 'https://cdn.test/p.jpg',
    });
    expect(plans[0].episodes.map((e) => [e.number, e.line, e.titleFr, e.videoUrl])).toEqual([
      [1, 3, undefined, 'https://src.test/1.mp4'],
      [2, 2, 'La fuite', 'https://src.test/2.mp4'],
    ]);
    expect(plans[1].episodes[0]).toMatchObject({ number: 1, priceCoinsOverride: 0 });
  });

  it('erreurs par ligne, sans bloquer les autres', () => {
    const csv = [
      'series_title,episode_number,video_url,maturity_rating,release_year,poster_url,episode_price_override',
      'A,0,,,,,',
      'A,1,http://pas-https.test/v.mp4,,,,',
      'A,2,,adulte,,,',
      'A,3,,,1800,,',
      'A,4,,,,ftp://x,',
      'A,5,,,,,-3',
      ',6,,,,,',
      'A,7,,,,,',
      'A,7,,,,,',
    ].join('\n');
    const { plans, errors } = planImport(csv);
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4, 5, 6, 7, 8, 10]);
    expect(errors[0].message).toContain('episode_number');
    expect(errors[1].message).toContain('https');
    expect(errors[7].message).toContain('en double');
    expect(plans[0].episodes.map((e) => e.number)).toEqual([7]);
  });

  it('en-tête : colonnes obligatoires, colonnes inconnues signalées, fichier vide, plafond de lignes', () => {
    expect(planImport('').errors[0].message).toBe('Fichier vide');
    expect(planImport('series_title\nA').errors[0].message).toContain('episode_number');
    expect(planImport('series_title,episode_number,couleur\nA,1,bleu').warnings[0].message).toContain('couleur');
    const big = ['series_title,episode_number', ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `A,${i + 1}`)].join('\n');
    expect(planImport(big).errors[0].message).toContain('Trop de lignes');
  });

  it('séparateur point-virgule et accents dans le slug', () => {
    const { plans } = planImport('series_title;episode_number\nMariage sous contrat — Saison 2;1');
    expect(plans[0].series.slug).toBe('mariage-sous-contrat-saison-2');
  });
});
