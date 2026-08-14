import { LogIn, Newspaper, Sparkles } from "lucide-react";
import { redirect } from "next/navigation";

import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageToggle } from "@/components/language-toggle";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getMissingReaderRuntimeEnvNames, isAllowedReaderEmail } from "@/lib/env";
import { localize } from "@/lib/reader-locale";
import { getReaderLocale } from "@/lib/reader-locale-server";
import { createSupabaseServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams: Promise<{
    sent?: string;
    error?: string;
  }>;
};

const errorMessages: Record<string, string> = {
  "not-allowed": "This email is not in ALLOWED_READER_EMAILS.",
  "password-required": "Enter your password.",
  "password-failed": "Password sign-in failed. Check the email, password, and Supabase user status.",
  "auth-failed": "The auth link could not be verified. Request a new link.",
  "missing-code": "The auth link is missing its verification code. Request a new link.",
};

async function signInWithPassword(formData: FormData) {
  "use server";

  if (getMissingReaderRuntimeEnvNames().length) {
    redirect("/login?error=server-config");
  }

  const email = String(formData.get("email") || "")
    .trim()
    .toLowerCase();

  if (!isAllowedReaderEmail(email)) {
    redirect("/login?error=not-allowed");
  }

  const password = String(formData.get("password") || "");
  if (!password) {
    redirect("/login?error=password-required");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    redirect("/login?error=password-failed");
  }

  redirect("/");
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const locale = await getReaderLocale();
  const missingEnvNames = getMissingReaderRuntimeEnvNames();
  const isConfigured = missingEnvNames.length === 0;
  const errorMessage = params.error ? errorMessages[params.error] || "Access was not granted." : null;

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden px-4 py-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,var(--color-primary)/0.12,transparent_35%),radial-gradient(circle_at_bottom_right,var(--color-accent)/0.18,transparent_38%)]" />
      <div className="absolute right-4 top-4 flex items-center gap-2 sm:right-6 sm:top-6">
        <LanguageToggle className="w-44 bg-background/80" />
        <ThemeToggle compact />
      </div>
      <Card className="relative w-full max-w-md border-border/70 bg-card/90 shadow-2xl backdrop-blur">
        <CardHeader className="gap-4">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <Newspaper aria-hidden="true" className="size-5" />
            </span>
            <div>
              <CardTitle className="text-xl">Daily News Digest</CardTitle>
              <CardDescription className="mt-1">{localize(locale, "Twój spokojny, prywatny przegląd najważniejszych wiadomości.", "Your calm, private overview of the day's most important news.")}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <Sparkles aria-hidden="true" className="size-4 shrink-0 text-primary" />
            {localize(locale, "Zaloguj się adresem dopuszczonym do czytnika.", "Sign in with an email address allowed to access the reader.")}
          </div>
          <form className="grid gap-3" action={signInWithPassword}>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required disabled={!isConfigured} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">{localize(locale, "Hasło", "Password")}</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                disabled={!isConfigured}
              />
            </div>
            <Button className="mt-1 h-11" type="submit" disabled={!isConfigured}>
              <LogIn aria-hidden="true" />
              {localize(locale, "Zaloguj się", "Sign in")}
            </Button>
          </form>

          {!isConfigured ? (
            <Alert variant="destructive">
              <AlertDescription>
                Reader config is missing: {missingEnvNames.join(", ")}. Add these values to the root
                .env file, then restart the reader container.
              </AlertDescription>
            </Alert>
          ) : null}
          {errorMessage && params.error !== "server-config" ? (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
