import "server-only";

import { cookies } from "next/headers";

import {
  normalizeReaderLocale,
  READER_LOCALE_COOKIE,
  type ReaderLocale,
} from "@/lib/reader-locale";

export async function getReaderLocale(): Promise<ReaderLocale> {
  const cookieStore = await cookies();
  return normalizeReaderLocale(cookieStore.get(READER_LOCALE_COOKIE)?.value);
}

