import AsyncStorage from "@react-native-async-storage/async-storage";
import { createMobileHttpApi, createMobileMockApi, demoTokenProvider, MOBILE_DEMO_USERS, type CurrentUser, type Locale, type MobileApi, type MobileDemoUserKey } from "@kadreo/domain";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * Who is signed in and which API the app talks to. Without EXPO_PUBLIC_API_URL the app runs on the
 * in-memory demo; with it, against the backend (demo sign-in by persona until phone + SMS
 * sign-in through Keycloak is wired).
 */

const API_URL = process.env.EXPO_PUBLIC_API_URL;
export const usesBackend = API_URL !== undefined && API_URL !== "";
/** Demo build: simulated GPS, camera fallback, device clock synced with the server. */
export const isDemo = !usesBackend || process.env.EXPO_PUBLIC_DEMO === "1";

function makeApi(user: MobileDemoUserKey): MobileApi {
  if (!usesBackend) return createMobileMockApi(user);
  const base = API_URL === "/" ? "" : API_URL!;
  const email = MOBILE_DEMO_USERS.find((u) => u.key === user)!.email;
  return createMobileHttpApi({ baseUrl: base, token: demoTokenProvider(base, email) });
}

interface Session {
  user: MobileDemoUserKey | null;
  api: MobileApi | null;
  me: CurrentUser | null;
  locale: Locale;
  setLocale: (l: Locale) => void;
  signIn: (u: MobileDemoUserKey) => void;
  signOut: () => void;
}

const Ctx = createContext<Session | null>(null);
const KEY = "kadreo.mobile.session";

async function load(): Promise<{ user?: MobileDemoUserKey; locale?: Locale }> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
async function save(v: { user?: MobileDemoUserKey | null; locale?: Locale }) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* storage unavailable: the session lives until reload */
  }
}

/** `?as=worker|leader|manager|kiosk` picks the persona on the web (deep links, tests). */
function personaFromUrl(): MobileDemoUserKey | null {
  if (typeof window === "undefined" || !window.location) return null;
  const m = /[?&#]as=(worker|leader|manager|kiosk)/.exec(window.location.href);
  return (m?.[1] as MobileDemoUserKey) ?? null;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<MobileDemoUserKey | null>(null);
  const [locale, setLocaleState] = useState<Locale>("ru");
  const [me, setMe] = useState<CurrentUser | null>(null);

  useEffect(() => {
    void load().then((s) => {
      setUser(personaFromUrl() ?? s.user ?? null);
      if (s.locale) setLocaleState(s.locale);
      setReady(true);
    });
  }, []);

  const api = useMemo(() => (user ? makeApi(user) : null), [user]);

  useEffect(() => {
    setMe(null);
    if (!api) return;
    let alive = true;
    void api.me().then((m) => {
      if (!alive) return;
      setMe(m);
    });
    return () => {
      alive = false;
    };
  }, [api]);

  const signIn = useCallback(
    (u: MobileDemoUserKey) => {
      setUser(u);
      void save({ user: u, locale });
    },
    [locale],
  );
  const signOut = useCallback(() => {
    setUser(null);
    void save({ user: null, locale });
  }, [locale]);
  const setLocale = useCallback(
    (l: Locale) => {
      setLocaleState(l);
      void save({ user, locale: l });
      void api?.updateLocale(l).catch(() => undefined);
    },
    [api, user],
  );

  const value = useMemo<Session>(() => ({ user, api, me, locale, setLocale, signIn, signOut }), [user, api, me, locale, setLocale, signIn, signOut]);
  if (!ready) return null;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}

/** The API of the signed-in user (screens render only after sign-in). */
export function useApi(): MobileApi {
  const { api } = useSession();
  if (!api) throw new Error("useApi before sign-in");
  return api;
}
