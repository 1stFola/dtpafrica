import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  adminLoginWithPassword,
  clearAdminApiKey,
  getAdminApiKey,
  getAdminJwt,
  setAdminApiKey,
  setAdminJwt,
  verifyAdminSession,
  type AdminSession,
} from "../../api/admin";
import { ADMIN_NAV_PERMISSIONS, canAccessNav } from "./admin-permissions";

type AdminAuthContextValue = {
  isAuthenticated: boolean;
  session: AdminSession | null;
  login: (apiKey: string) => Promise<void>;
  loginWithPassword: (email: string, password: string) => Promise<void>;
  logout: () => void;
  checkStored: () => Promise<boolean>;
  hasPermission: (slug: string | string[]) => boolean;
  canAccessPath: (path: string) => boolean;
};

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [session, setSession] = useState<AdminSession | null>(null);

  const checkStored = useCallback(async () => {
    if (!getAdminApiKey() && !getAdminJwt()) {
      setIsAuthenticated(false);
      setSession(null);
      return false;
    }
    try {
      const next = await verifyAdminSession();
      setSession(next);
      setIsAuthenticated(true);
      return true;
    } catch {
      clearAdminApiKey();
      setIsAuthenticated(false);
      setSession(null);
      return false;
    }
  }, []);

  const login = useCallback(async (apiKey: string) => {
    setAdminApiKey(apiKey.trim());
    const next = await verifyAdminSession();
    setSession(next);
    setIsAuthenticated(true);
  }, []);

  const loginWithPassword = useCallback(async (email: string, password: string) => {
    const result = await adminLoginWithPassword(email, password);
    setAdminJwt(result.token);
    setSession(result.session);
    setIsAuthenticated(true);
  }, []);

  const logout = useCallback(() => {
    clearAdminApiKey();
    setIsAuthenticated(false);
    setSession(null);
  }, []);

  const hasPermission = useCallback(
    (slug: string | string[]) => {
      if (!session) return false;
      if (session.method === "api_key") return true;
      const slugs = Array.isArray(slug) ? slug : [slug];
      return slugs.some((s) => session.permissions.includes(s));
    },
    [session]
  );

  const canAccessPath = useCallback(
    (path: string) => {
      if (!session) return false;
      const key = Object.keys(ADMIN_NAV_PERMISSIONS).find(
        (navPath) => path === navPath || path.startsWith(`${navPath}/`)
      );
      if (!key) return true;
      return canAccessNav(
        session.permissions,
        session.method,
        ADMIN_NAV_PERMISSIONS[key]
      );
    },
    [session]
  );

  const value = useMemo(
    () => ({
      isAuthenticated,
      session,
      login,
      loginWithPassword,
      logout,
      checkStored,
      hasPermission,
      canAccessPath,
    }),
    [
      isAuthenticated,
      session,
      login,
      loginWithPassword,
      logout,
      checkStored,
      hasPermission,
      canAccessPath,
    ]
  );

  useEffect(() => {
    void checkStored();
  }, [checkStored]);

  return (
    <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error("useAdminAuth requires AdminAuthProvider");
  return ctx;
}
