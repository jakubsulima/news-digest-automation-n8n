"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";

import { localize, type ReaderLocale } from "@/lib/reader-locale";

const ReaderLocaleContext = createContext<ReaderLocale>("pl");

export function ReaderLocaleProvider({
  children,
  locale,
}: {
  children: ReactNode;
  locale: ReaderLocale;
}) {
  return (
    <ReaderLocaleContext.Provider value={locale}>
      {children}
    </ReaderLocaleContext.Provider>
  );
}

export function useReaderLocale() {
  return useContext(ReaderLocaleContext);
}

export function useLocalize() {
  const locale = useReaderLocale();
  return useCallback(<T,>(polish: T, english: T) => localize(locale, polish, english), [locale]);
}
