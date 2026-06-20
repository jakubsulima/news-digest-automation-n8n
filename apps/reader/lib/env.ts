const requiredServerEnv = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

const requiredReaderRuntimeEnv = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ALLOWED_READER_EMAILS",
  "INGEST_SECRET",
  "CRON_SECRET",
] as const;

export function requireEnv(name: (typeof requiredServerEnv)[number] | "INGEST_SECRET" | "CRON_SECRET"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getMissingReaderRuntimeEnvNames(): string[] {
  return requiredReaderRuntimeEnv.filter((name) => !process.env[name]);
}

export function hasReaderRuntimeConfig(): boolean {
  return getMissingReaderRuntimeEnvNames().length === 0;
}

function getAllowedReaderEmails(): string[] {
  return (process.env.ALLOWED_READER_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedReaderEmail(email: string | null | undefined): boolean {
  const allowed = getAllowedReaderEmails();
  return Boolean(email && allowed.includes(email.toLowerCase()));
}

export function getAppUrl(): string {
  const value = process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000";

  try {
    const url = new URL(value);
    if (url.hostname === "0.0.0.0") {
      url.hostname = "127.0.0.1";
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return "http://127.0.0.1:3000";
  }
}
