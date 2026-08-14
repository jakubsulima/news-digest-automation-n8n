export const READER_LOCALES = ["pl", "en"] as const;

export type ReaderLocale = (typeof READER_LOCALES)[number];

export const READER_LOCALE_COOKIE = "reader-locale";

export function normalizeReaderLocale(value: string | null | undefined): ReaderLocale {
  return value === "en" ? "en" : "pl";
}

export function localeTag(locale: ReaderLocale) {
  return locale === "en" ? "en-GB" : "pl-PL";
}

export function localize<T>(locale: ReaderLocale, polish: T, english: T): T {
  return locale === "en" ? english : polish;
}

