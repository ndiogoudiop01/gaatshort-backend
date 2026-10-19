import { LocalizationController } from '../presentation/http/localization.controller';
import type { LocalizationService } from '../application/services/localization.service';

describe('LocalizationController', () => {
  it('délègue la liste des pays à la query dédiée', async () => {
    const availableCountries = jest.fn(() => Promise.resolve([]));
    const controller = new LocalizationController({ availableCountries } as unknown as LocalizationService);

    await controller.countries();

    expect(availableCountries).toHaveBeenCalledWith();
  });

  it('délègue la liste des devises à la query dédiée', async () => {
    const currencies = jest.fn(() => Promise.resolve([]));
    const controller = new LocalizationController({ currencies } as unknown as LocalizationService);

    await controller.currencies();

    expect(currencies).toHaveBeenCalledWith();
  });

  describe('context — contexte par défaut du tenant (US-IG-029)', () => {
    it('expose locale, pays, devise et fuseau du tenant courant', () => {
      const controller = new LocalizationController({} as LocalizationService);

      const result = controller.context({
        defaultLocale: 'en',
        defaultCountry: 'CI',
        defaultCurrency: 'XOF',
        timezone: 'Africa/Abidjan',
      } as never);

      expect(result).toEqual({
        locale: 'en',
        countryCode: 'CI',
        currencyCode: 'XOF',
        timezone: 'Africa/Abidjan',
      });
    });

    it('retombe sur des valeurs par défaut sûres quand le tenant est absent', () => {
      const controller = new LocalizationController({} as LocalizationService);

      const result = controller.context(undefined as never);

      expect(result).toEqual({
        locale: 'fr',
        countryCode: 'SN',
        currencyCode: 'XOF',
        timezone: 'Africa/Dakar',
      });
    });
  });
});
