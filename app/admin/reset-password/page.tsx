"use client";

import {
  FormEvent,
  useEffect,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type PageState =
  | "loading"
  | "ready"
  | "saving"
  | "success"
  | "error";

export default function ResetPasswordPage() {
  const router = useRouter();

  const [supabase] = useState(() =>
    createClient()
  );

  const [state, setState] =
    useState<PageState>("loading");

  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [confirmPassword, setConfirmPassword] =
    useState("");

  const [showPassword, setShowPassword] =
    useState(false);

  const [showConfirmPassword, setShowConfirmPassword] =
    useState(false);

  const [error, setError] =
    useState("");

  useEffect(() => {
    let mounted = true;

    async function initialize() {
      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (!mounted) {
          return;
        }

        if (sessionError) {
          console.error(
            "INVITATION/RESET SESSION ERROR:",
            sessionError
          );

          setError(
            "Could not verify your session. Please open the newest email link again."
          );

          setState("error");
          return;
        }

        if (!session?.user) {
          setError(
            "This link is missing or has expired. Please request a new link."
          );

          setState("error");
          return;
        }

        setEmail(
          session.user.email ?? ""
        );

        setState("ready");
      } catch (initializeError) {
        console.error(
          "INITIALIZATION ERROR:",
          initializeError
        );

        if (!mounted) {
          return;
        }

        setError(
          "Could not verify this link."
        );

        setState("error");
      }
    }

    void initialize();

    return () => {
      mounted = false;
    };
  }, [supabase]);

  function validatePassword() {
    if (password.length < 8) {
      return "Password must be at least 8 characters.";
    }

    if (!/[A-Z]/.test(password)) {
      return "Password must contain at least one uppercase letter.";
    }

    if (!/[a-z]/.test(password)) {
      return "Password must contain at least one lowercase letter.";
    }

    if (!/[0-9]/.test(password)) {
      return "Password must contain at least one number.";
    }

    if (password !== confirmPassword) {
      return "Passwords do not match.";
    }

    return "";
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setError("");

    const validationError =
      validatePassword();

    if (validationError) {
      setError(validationError);
      return;
    }

    setState("saving");

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (
        sessionError ||
        !session?.user
      ) {
        throw new Error(
          "Your session is no longer valid. Please request a new link."
        );
      }

      const { error: updateError } =
        await supabase.auth.updateUser({
          password,
        });

      if (updateError) {
        throw updateError;
      }

      await supabase.auth.signOut();

      setState("success");

      window.setTimeout(() => {
        router.replace("/admin/login");
      }, 1800);
    } catch (saveError) {
      console.error(
        "ADMIN PASSWORD SETUP ERROR:",
        saveError
      );

      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not set your password."
      );

      setState("ready");
    }
  }

  if (state === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f5f5f5] px-5">
        <div className="text-center">
          <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-black text-white">
            <ShieldCheck size={20} />
          </div>

          <h1 className="text-2xl font-semibold text-black">
            Verifying session
          </h1>

          <p className="mt-3 text-sm text-black/45">
            Checking your secure link...
          </p>
        </div>
      </main>
    );
  }

  if (state === "error") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f5f5f5] px-5">
        <div className="w-full max-w-lg rounded-[28px] bg-white p-8 shadow-sm md:p-10">
          <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
            <ShieldCheck size={21} />
          </div>

          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-black/35">
            Saviskar 2026
          </p>

          <h1 className="text-3xl font-semibold tracking-[-0.04em] text-black">
            Link unavailable
          </h1>

          <p className="mt-4 text-sm leading-6 text-black/50">
            {error}
          </p>

          <button
            type="button"
            onClick={() =>
              router.replace("/admin/login")
            }
            className="mt-7 w-full rounded-xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:bg-black/90"
          >
            Go to Admin Login
          </button>
        </div>
      </main>
    );
  }

  if (state === "success") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f5f5f5] px-5">
        <div className="w-full max-w-lg rounded-[28px] bg-white p-8 text-center shadow-sm md:p-10">
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-green-50 text-green-600">
            <CheckCircle2 size={27} />
          </div>

          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-black/35">
            Saviskar 2026
          </p>

          <h1 className="text-3xl font-semibold tracking-[-0.04em] text-black">
            Password set
          </h1>

          <p className="mt-4 text-sm leading-6 text-black/50">
            Your administrator password has
            been set successfully.
          </p>

          <p className="mt-3 text-xs text-black/30">
            Redirecting you to Admin Login...
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f5f5] px-5 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-8 text-center">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-black/35">
            Saviskar 2026
          </p>

          <h1 className="text-4xl font-semibold tracking-[-0.05em] text-black">
            Set your password
          </h1>

          <p className="mt-4 text-sm leading-6 text-black/45">
            Create a secure password to access your administrator account.
          </p>
        </div>

        <div className="rounded-[28px] bg-white p-7 shadow-sm md:p-9">
          <div className="mb-7 flex items-center gap-4 rounded-2xl bg-black/[0.03] p-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black text-white">
              <ShieldCheck size={18} />
            </div>

            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-black/35">
                Administrator account
              </p>

              <p className="mt-1 truncate text-sm font-medium text-black">
                {email}
              </p>
            </div>
          </div>

          {error && (
            <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-5 text-red-700">
              {error}
            </div>
          )}

          <form
            onSubmit={handleSubmit}
            className="space-y-5"
          >
            <div>
              <label className="mb-2 block text-xs font-medium text-black/60">
                New password
              </label>

              <div className="relative">
                <Lock
                  size={16}
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-black/30"
                />

                <input
                  type={
                    showPassword
                      ? "text"
                      : "password"
                  }
                  value={password}
                  onChange={(event) =>
                    setPassword(
                      event.target.value
                    )
                  }
                  autoComplete="new-password"
                  placeholder="Create a secure password"
                  className="w-full rounded-xl border border-black/10 bg-black/[0.02] py-3 pl-11 pr-12 text-sm text-black outline-none transition focus:border-black/30"
                  required
                />

                <button
                  type="button"
                  onClick={() =>
                    setShowPassword(
                      (value) => !value
                    )
                  }
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-black/35 transition hover:text-black"
                  aria-label={
                    showPassword
                      ? "Hide password"
                      : "Show password"
                  }
                >
                  {showPassword ? (
                    <EyeOff size={16} />
                  ) : (
                    <Eye size={16} />
                  )}
                </button>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-xs font-medium text-black/60">
                Confirm password
              </label>

              <div className="relative">
                <Lock
                  size={16}
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-black/30"
                />

                <input
                  type={
                    showConfirmPassword
                      ? "text"
                      : "password"
                  }
                  value={confirmPassword}
                  onChange={(event) =>
                    setConfirmPassword(
                      event.target.value
                    )
                  }
                  autoComplete="new-password"
                  placeholder="Enter the password again"
                  className="w-full rounded-xl border border-black/10 bg-black/[0.02] py-3 pl-11 pr-12 text-sm text-black outline-none transition focus:border-black/30"
                  required
                />

                <button
                  type="button"
                  onClick={() =>
                    setShowConfirmPassword(
                      (value) => !value
                    )
                  }
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-black/35 transition hover:text-black"
                  aria-label={
                    showConfirmPassword
                      ? "Hide password"
                      : "Show password"
                  }
                >
                  {showConfirmPassword ? (
                    <EyeOff size={16} />
                  ) : (
                    <Eye size={16} />
                  )}
                </button>
              </div>
            </div>

            <div className="rounded-xl bg-black/[0.03] p-4 text-xs leading-5 text-black/45">
              Password must contain:
              <ul className="mt-2 space-y-1">
                <li>• At least 8 characters</li>
                <li>
                  • At least one uppercase letter
                </li>
                <li>
                  • At least one lowercase letter
                </li>
                <li>• At least one number</li>
              </ul>
            </div>

            <button
              type="submit"
              disabled={
                state === "saving" ||
                !password ||
                !confirmPassword
              }
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-black px-5 py-3.5 text-sm font-medium text-white transition hover:bg-black/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ShieldCheck size={16} />

              {state === "saving"
                ? "Setting password..."
                : "Set Password"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}