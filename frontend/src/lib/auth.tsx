import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, setUnauthorizedHandler, tokenStore } from "./api";
import type { Session } from "./types";

interface AuthCtx {
  session: Session | null;
  loading: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<Session>;
  signup: (body: { name: string; email: string; password: string; phone: string; shop_name: string }) => Promise<Session>;
  demo: () => Promise<Session>;
  loggedOutByUser: boolean; // true after an intentional logout (route guard sends to / instead of /login)
  logout: (byUser?: boolean) => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null!);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!!tokenStore.get());
  const [loggedOutByUser, setByUser] = useState(false);

  const logout = useCallback((byUser = false) => {
    tokenStore.clear();
    setByUser(byUser === true);
    setSession(null);
    qc.clear();
  }, [qc]);

  const accept = useCallback((r: Session & { token?: string }) => {
    if (r.token) tokenStore.set(r.token);
    const s = { user: r.user, shop: r.shop, mock_mode: r.mock_mode };
    setByUser(false);
    setSession(s);
    return s;
  }, []);

  const refresh = useCallback(async () => {
    try { accept(await api.get<Session>("/auth/me")); } catch { logout(); }
  }, [accept, logout]);

  useEffect(() => {
    setUnauthorizedHandler(() => logout(false));
    if (tokenStore.get()) refresh().finally(() => setLoading(false));
  }, [logout, refresh]);

  const value = useMemo<AuthCtx>(() => ({
    session, loading, loggedOutByUser, isAdmin: session?.user.role === "admin",
    login: async (email, password) => { qc.clear(); return accept(await api.post("/auth/login", { email, password })); },
    signup: async (body) => { qc.clear(); return accept(await api.post("/auth/signup", body)); },
    demo: async () => { qc.clear(); return accept(await api.post("/auth/demo")); },
    logout, refresh,
  }), [session, loading, loggedOutByUser, accept, logout, refresh, qc]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
