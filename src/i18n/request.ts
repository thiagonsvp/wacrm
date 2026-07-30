import { getRequestConfig } from 'next-intl/server';

const SUPPORTED_LOCALES = ['en', 'pt-BR'];

export default getRequestConfig(async () => {
  // O CRM começa em português; outra localidade pode ser escolhida pela variável de ambiente.
  const requestedLocale = process.env.NEXT_PUBLIC_APP_LOCALE || 'pt-BR';
  const locale = SUPPORTED_LOCALES.includes(requestedLocale) ? requestedLocale : 'pt-BR';

  let messages;
  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch (error) {
    // Fallback to português para manter a interface consistente.
    messages = (await import(`../../messages/pt-BR.json`)).default;
  }

  return {
    locale,
    messages
  };
});
