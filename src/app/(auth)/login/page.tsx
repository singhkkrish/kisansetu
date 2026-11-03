import type { Metadata } from "next";
import { Sprout } from "lucide-react";
import { redirect } from "next/navigation";
import { LoginForm } from "@/app/(auth)/login/login-form";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { Notice } from "@/components/ui/notice";
import { en, mr } from "@/lib/i18n/messages";
import { getAuthState } from "@/lib/services/session";
import { readSupabaseEnv } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "Sign in" };

// Read the environment on every request instead of baking it into the build.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const configured = readSupabaseEnv() !== null;
  const state = configured ? await getAuthState() : null;

  if (state?.status === "ready") redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <div className="mb-8 flex items-center gap-3 text-primary">
        <Sprout className="h-9 w-9" aria-hidden="true" />
        <span className="text-3xl font-bold">{mr.appName}</span>
      </div>

      <h1 className="text-2xl font-bold">{mr.signIn}</h1>
      <p className="mt-1 text-muted">
        {mr.signInIntro} <span lang="en">{en.signInIntro}</span>
      </p>

      <div className="mt-8 space-y-4">
        {!configured ? (
          <Notice tone="warn">
            <p className="font-semibold">{en.setupRequiredTitle}</p>
            <p className="mt-1">{en.setupRequiredBody}</p>
          </Notice>
        ) : state?.status === "no_profile" ? (
          <>
            <Notice tone="error">
              <p className="font-semibold">
                {mr.auth.noProfileTitle} <span lang="en" className="font-normal">/ {en.auth.noProfileTitle}</span>
              </p>
              <p className="mt-1">{mr.auth.noProfileBody}</p>
              <p className="mt-1" lang="en">{en.auth.noProfileBody}</p>
            </Notice>
            <SignOutButton label={mr.signOut} />
          </>
        ) : (
          <LoginForm
            labels={{ email: mr.email, password: mr.password, submit: mr.signIn, busy: mr.signingIn, failed: mr.signInFailed }}
          />
        )}
      </div>
    </main>
  );
}
