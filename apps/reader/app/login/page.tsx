import { LogIn } from "lucide-react";
import { redirect } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getMissingReaderRuntimeEnvNames, isAllowedReaderEmail } from "@/lib/env";
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
  const missingEnvNames = getMissingReaderRuntimeEnvNames();
  const isConfigured = missingEnvNames.length === 0;
  const errorMessage = params.error ? errorMessages[params.error] || "Access was not granted." : null;

  return (
    <main className="grid min-h-screen place-items-center px-4 py-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">Daily News Digest</CardTitle>
          <CardDescription>Sign in with your allowed email address.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <form className="grid gap-3" action={signInWithPassword}>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required disabled={!isConfigured} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                disabled={!isConfigured}
              />
            </div>
            <Button className="h-10" type="submit" disabled={!isConfigured}>
              <LogIn aria-hidden="true" />
              Sign in
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
