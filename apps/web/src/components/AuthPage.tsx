import { useState, type FormEvent } from "react";
import { useSignIn, useSignUp } from "@clerk/clerk-react";

type AuthMode = "sign-in" | "sign-up";
type SignInStep = "identifier" | "password" | "code";
type SignInCodeFactor = "first" | "second";
const demoCredentials = [
  {
    role: "Admin",
    email: "demo.admin@routepulse.justshivamm.in",
    password: "RoutePulseDemo!Admin2026",
  },
  {
    role: "Dispatcher",
    email: "demo.dispatcher@routepulse.justshivamm.in",
    password: "RoutePulseDemo!Dispatch2026",
  },
  {
    role: "Driver",
    email: "demo.driver@routepulse.justshivamm.in",
    password: "RoutePulseDemo!Driver2026",
  },
  {
    role: "Customer",
    email: "demo.customer@routepulse.justshivamm.in",
    password: "RoutePulseDemo!Customer2026",
  },
] as const;

function errorMessage(reason: unknown) {
  if (reason && typeof reason === "object" && "errors" in reason) {
    const errors = (reason as { errors?: unknown }).errors;
    if (Array.isArray(errors) && errors.length > 0) {
      const first = errors[0];
      if (first && typeof first === "object") {
        const detail = first as { longMessage?: unknown; message?: unknown };
        if (typeof detail.longMessage === "string") return detail.longMessage;
        if (typeof detail.message === "string") return detail.message;
      }
    }
  }
  if (reason instanceof Error && reason.message) return reason.message;
  return "We could not complete that request. Check your details and try again.";
}

function setAuthHash(mode: AuthMode) {
  window.history.replaceState(null, "", mode === "sign-up" ? "#/sign-up" : "#/sign-in");
}

export default function AuthPage() {
  const { isLoaded: signInLoaded, signIn, setActive: setActiveSignIn } = useSignIn();
  const { isLoaded: signUpLoaded, signUp, setActive: setActiveSignUp } = useSignUp();
  const [mode, setMode] = useState<AuthMode>(() =>
    window.location.hash.includes("sign-up") ? "sign-up" : "sign-in",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [code, setCode] = useState("");
  const [verificationPending, setVerificationPending] = useState(false);
  const [signInStep, setSignInStep] = useState<SignInStep>("identifier");
  const [signInCodeFactor, setSignInCodeFactor] = useState<SignInCodeFactor>("first");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const changeMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setAuthHash(nextMode);
    setError("");
    setNotice("");
    setVerificationPending(false);
    setSignInStep("identifier");
    setSignInCodeFactor("first");
    setCode("");
  };

  const useDemoCredential = (credential: (typeof demoCredentials)[number]) => {
    setMode("sign-in");
    setAuthHash("sign-in");
    setEmail(credential.email);
    setPassword(credential.password);
    setSignInStep("identifier");
    setSignInCodeFactor("first");
    setVerificationPending(false);
    setCode("");
    setError("");
    setNotice(`${credential.role} demo credentials loaded. Select Continue to sign in.`);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    setLoading(true);
    try {
      if (mode === "sign-in") {
        if (!signIn || !setActiveSignIn) throw new Error("Authentication is still loading");
        const result = signInStep === "identifier"
          ? await signIn.create({ identifier: email.trim() })
          : signInStep === "password"
            ? await signIn.attemptFirstFactor({ strategy: "password", password })
            : signInCodeFactor === "second"
              ? await signIn.attemptSecondFactor({ strategy: "email_code", code: code.trim() })
              : await signIn.attemptFirstFactor({ strategy: "email_code", code: code.trim() });
        if (result.status === "complete" && result.createdSessionId) {
          await setActiveSignIn({ session: result.createdSessionId });
        } else if (signInStep === "identifier") {
          const factors = result.supportedFirstFactors ?? [];
          if (factors.some((factor) => factor.strategy === "password")) {
            setSignInStep("password");
            setNotice("Enter your password to continue.");
          } else {
            const emailFactor = factors.find((factor) => factor.strategy === "email_code");
            if (emailFactor) {
              await signIn.prepareFirstFactor({ strategy: "email_code", emailAddressId: emailFactor.emailAddressId });
              setSignInStep("code");
              setNotice("We sent a verification code to your email address.");
            } else {
              throw new Error("This account does not have a supported sign-in method. Contact an administrator.");
            }
          }
        } else if (
          signInStep === "password" &&
          (result.status === "needs_second_factor" || (result.status as string) === "needs_client_trust")
        ) {
          const secondFactors = result.supportedSecondFactors ?? [];
          const emailFactor = secondFactors.find((factor) => factor.strategy === "email_code");
          if (!emailFactor) {
            throw new Error("This account requires an authenticator or backup code. Use the Clerk sign-in options or contact an administrator.");
          }
          await signIn.prepareSecondFactor({
            strategy: "email_code",
            emailAddressId: emailFactor.emailAddressId,
          });
          setSignInCodeFactor("second");
          setSignInStep("code");
          setNotice("We sent a verification code to the account email address.");
        } else {
          throw new Error("Additional verification is required for this account. Use the Clerk sign-in options or contact an administrator.");
        }
      } else if (!verificationPending) {
        if (!signUp || !setActiveSignUp) throw new Error("Authentication is still loading");
        await signUp.create({
          emailAddress: email.trim(),
          password,
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim() || undefined,
        });
        await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
        setVerificationPending(true);
        setNotice("We sent a verification code to your email address.");
      } else {
        if (!signUp || !setActiveSignUp) throw new Error("Authentication is still loading");
        const result = await signUp.attemptEmailAddressVerification({ code: code.trim() });
        if (result.status === "complete" && result.createdSessionId) {
          await setActiveSignUp({ session: result.createdSessionId });
        } else {
          throw new Error("Your account needs one more verification step. Please try again or contact an administrator.");
        }
      }
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  };

  const continueWithGoogle = async () => {
    setError("");
    setLoading(true);
    try {
      const callback = `${window.location.origin}/sso-callback`;
      if (mode === "sign-in") {
        if (!signIn) throw new Error("Authentication is still loading");
        await signIn.authenticateWithRedirect({
          strategy: "oauth_google",
          redirectUrl: callback,
          redirectUrlComplete: `${window.location.origin}/#/overview`,
        });
      } else {
        if (!signUp) throw new Error("Authentication is still loading");
        await signUp.authenticateWithRedirect({
          strategy: "oauth_google",
          redirectUrl: callback,
          redirectUrlComplete: `${window.location.origin}/#/overview`,
        });
      }
    } catch (reason) {
      setError(errorMessage(reason));
      setLoading(false);
    }
  };

  const loaded = signInLoaded && signUpLoaded;
  const isSignInCode = mode === "sign-in" && signInStep === "code";
  const isVerification = (mode === "sign-up" && verificationPending) || isSignInCode;
  const needsSignInPassword = mode === "sign-in" && signInStep === "password";

  return (
    <main className="auth-screen">
      <section className="auth-visual" aria-label="RoutePulse platform">
        <div className="auth-visual-grid" />
        <div className="auth-visual-copy">
          <div className="auth-status"><span /> LIVE OPERATIONS</div>
          <h1>Every delivery.<br /><span>In motion.</span></h1>
          <p>Plan routes, coordinate drivers, and turn fleet activity into clear decisions.</p>
          <div className="auth-metrics">
            <span><strong>24/7</strong> visibility</span>
            <span><strong>REAL-TIME</strong> dispatch</span>
          </div>
        </div>
      </section>
      <section className="auth-panel" aria-labelledby="auth-title">
        <div className="auth-panel-inner">
          <img className="auth-logo" src="/logo.png" alt="RoutePulse" />
          <p className="auth-kicker">ROUTEPULSE / OPERATIONS OS</p>
          <h2 id="auth-title">{isVerification ? "Verify your email" : mode === "sign-in" ? "Welcome back" : "Create your workspace"}</h2>
          <p className="auth-subtitle">
            {isVerification ? "Enter the six-digit code we sent to continue." : mode === "sign-in" ? "Sign in to keep your network moving." : "Start coordinating deliveries with a secure account."}
          </p>

          {!isVerification && (
            <button className="auth-google" type="button" onClick={() => void continueWithGoogle()} disabled={!loaded || loading}>
              <span className="auth-google-mark" aria-hidden="true">G</span>
              Continue with Google
            </button>
          )}
          {!isVerification && <div className="auth-divider"><span>OR USE EMAIL</span></div>}

          <form className="auth-form" onSubmit={(event) => void submit(event)}>
            {mode === "sign-up" && !isVerification && (
              <div className="auth-form-grid">
                <label>First name<input value={firstName} onChange={(event) => setFirstName(event.target.value)} autoComplete="given-name" placeholder="Shivam" /></label>
                <label>Last name<input value={lastName} onChange={(event) => setLastName(event.target.value)} autoComplete="family-name" placeholder="Kumar" /></label>
              </div>
            )}
            {!isVerification && (
              <label>Email address<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@company.com" /></label>
            )}
            {isVerification ? (
              <label>Verification code<input inputMode="numeric" pattern="[0-9]*" required value={code} onChange={(event) => setCode(event.target.value)} autoComplete="one-time-code" placeholder="000000" /></label>
            ) : mode === "sign-up" || needsSignInPassword ? (
              <label>Password<input type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} placeholder="At least 8 characters" /></label>
            ) : null}
            {error && <p className="auth-feedback auth-feedback-error" role="alert">{error}</p>}
            {notice && <p className="auth-feedback auth-feedback-notice" role="status">{notice}</p>}
            <button className="auth-submit" type="submit" disabled={!loaded || loading}>
              {loading ? "Working…" : isVerification ? "Verify email" : needsSignInPassword ? "Sign in" : mode === "sign-in" ? "Continue" : "Create account"}
              <span aria-hidden="true">→</span>
            </button>
          </form>

          {mode === "sign-in" && !isVerification && (
            <section className="demo-credentials" aria-labelledby="demo-credentials-title">
              <div className="demo-credentials-heading">
                <div>
                  <span className="auth-kicker">PUBLIC SANDBOX</span>
                  <h3 id="demo-credentials-title">Try a role workspace</h3>
                </div>
                <span className="technical-badge">DEMO</span>
              </div>
              <p>These accounts are for exploring the RoutePulse interface only.</p>
              <div className="demo-credential-list">
                {demoCredentials.map((credential) => (
                  <button
                    className="demo-credential"
                    key={credential.role}
                    type="button"
                    onClick={() => useDemoCredential(credential)}
                    disabled={!loaded || loading}
                  >
                    <span className="demo-credential-role">{credential.role}</span>
                    <span className="demo-credential-email">{credential.email}</span>
                    <span className="demo-credential-action">Use credentials →</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {isVerification && <button className="auth-text-button" type="button" onClick={() => { setVerificationPending(false); setSignInStep("identifier"); setCode(""); setNotice(""); setError(""); }}>Use a different email</button>}
          {!isVerification && <p className="auth-switch">{mode === "sign-in" ? "New to RoutePulse?" : "Already have an account?"} <button type="button" onClick={() => changeMode(mode === "sign-in" ? "sign-up" : "sign-in")}>{mode === "sign-in" ? "Create an account" : "Sign in"}</button></p>}
          <p className="auth-legal">By continuing, you agree to RoutePulse terms and privacy policy.</p>
        </div>
        <div className="auth-footer"><span className="auth-footer-dot" /> Secure authentication by Clerk <span>•</span> RoutePulse v1.0</div>
      </section>
    </main>
  );
}
