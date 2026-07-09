import { getRequestConfig } from 'next-intl/server';

const SUPPORTED_LOCALES = ['en', 'pt-BR'];

export default getRequestConfig(async () => {
  // Read the locale from the environment, defaulting to 'en'
  const requestedLocale = process.env.NEXT_PUBLIC_APP_LOCALE || 'en';
  const locale = SUPPORTED_LOCALES.includes(requestedLocale) ? requestedLocale : 'en';

  let messages;
  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch (error) {
    // Fallback to English if the dictionary for the requested locale doesn't exist yet
    messages = (await import(`../../messages/en.json`)).default;
  }

  return {
    locale,
    messages
  };
});
