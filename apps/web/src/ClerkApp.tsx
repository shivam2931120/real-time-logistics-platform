import { useEffect, useRef, useState } from "react";
import { AuthenticateWithRedirectCallback, useAuth, useClerk } from "@clerk/clerk-react";
import App from "./App";
import AuthPage from "./components/AuthPage";
import { api, setToken, setTokenProvider } from "./lib/api";
import { TrackingPage } from "./pages/TrackingPage";
export default function ClerkApp() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { signOut } = useClerk();
  const getTokenRef = useRef(getToken);
  const [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  const publicTracking =
    window.location.pathname === "/track" ||
    window.location.pathname.startsWith("/track/");
  const oauthCallback = window.location.pathname === "/sso-callback";
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);
  useEffect(() => {
    let cancelled = false;
    if (publicTracking || oauthCallback) {
      setTokenProvider(null);
      return;
    }
    if (!isLoaded) return;
    if (!isSignedIn) {
      setTokenProvider(null);
      setToken("");
      setReady(false);
      setError("");
      return;
    }
    setReady(false);
    setError("");
    const tokenGetter = getTokenRef.current;
    setTokenProvider((options) => tokenGetter(options));
    void (async () => {
      try {
        const value = await tokenGetter();
        if (!value) throw new Error("Clerk did not issue a session token");
        setToken(value);
        await api.me();
        if (!cancelled) setReady(true);
      } catch (reason) {
        setToken("");
        if (!cancelled)
          setError(
            reason instanceof Error
              ? reason.message
              : "Unable to authorize this workspace",
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt, isLoaded, isSignedIn, oauthCallback, publicTracking]);
  if (publicTracking) return <TrackingPage />;
  if (oauthCallback) return <AuthenticateWithRedirectCallback />;
  if (!isLoaded) return <div className="splash">Loading secure workspace…</div>;
  if (!isSignedIn)
    return (
      <AuthPage />
    );
  if (error)
    return (
      <main className="splash auth-error" role="alert">
        <h1>Workspace authorization failed</h1>
        <p>{error}</p>
        <div>
          <button
            className="button primary"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Try again
          </button>
          <button
            className="button ghost"
            onClick={() => {
              setTokenProvider(null);
              setToken("");
              void signOut();
            }}
          >
            Sign out
          </button>
        </div>
      </main>
    );
  if (!ready) return <div className="splash">Authorizing workspace…</div>;
  return <App key={api.token()} />;
}
