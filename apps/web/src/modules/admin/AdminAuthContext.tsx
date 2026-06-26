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
  clearAdminApiKey,
  getAdminApiKey,
  setAdminApiKey,
  verifyAdminSession,
} from "../../api/admin";

type AdminAuthContextValue = {
  isAuthenticated: boolean;
  login: (apiKey: string) => Promise<void>;
  logout: () => void;
  checkStored: () => Promise<boolean>;
};

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const checkStored = useCallback(async () => {
    if (!getAdminApiKey()) {
      setIsAuthenticated(false);
      return false;
    }
    try {
      await verifyAdminSession();
      setIsAuthenticated(true);
      return true;
    } catch {
      clearAdminApiKey();
      setIsAuthenticated(false);
      return false;
    }
  }, []);

  const login = useCallback(async (apiKey: string) => {
    setAdminApiKey(apiKey.trim());
    await verifyAdminSession();
    setIsAuthenticated(true);
  }, []);

  const logout = useCallback(() => {
    clearAdminApiKey();
    setIsAuthenticated(false);
  }, []);

  const value = useMemo(
    () => ({ isAuthenticated, login, logout, checkStored }),
    [isAuthenticated, login, logout, checkStored]
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
