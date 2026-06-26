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
  academyLogin,
  clearAcademyToken,
  getAcademyToken,
  setAcademyToken,
  verifyAcademySession,
  type AcademyLoginResponse,
} from "../../api/academy-auth";

type AcademyAuthContextValue = {
  isAuthenticated: boolean;
  academy: AcademyLoginResponse["academy"] | null;
  login: (username: string, password: string) => Promise<AcademyLoginResponse["academy"]>;
  logout: () => void;
  checkStored: () => Promise<boolean>;
};

const AcademyAuthContext = createContext<AcademyAuthContextValue | null>(null);

export function AcademyAuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [academy, setAcademy] = useState<AcademyLoginResponse["academy"] | null>(null);

  const checkStored = useCallback(async () => {
    if (!getAcademyToken()) {
      setIsAuthenticated(false);
      setAcademy(null);
      return false;
    }
    try {
      const session = await verifyAcademySession();
      setAcademy(session.academy);
      setIsAuthenticated(true);
      return true;
    } catch {
      clearAcademyToken();
      setIsAuthenticated(false);
      setAcademy(null);
      return false;
    }
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await academyLogin(username, password);
    setAcademyToken(res.token);
    setAcademy(res.academy);
    setIsAuthenticated(true);
    return res.academy;
  }, []);

  const logout = useCallback(() => {
    clearAcademyToken();
    setIsAuthenticated(false);
    setAcademy(null);
  }, []);

  const value = useMemo(
    () => ({ isAuthenticated, academy, login, logout, checkStored }),
    [isAuthenticated, academy, login, logout, checkStored]
  );

  useEffect(() => {
    void checkStored();
  }, [checkStored]);

  return (
    <AcademyAuthContext.Provider value={value}>{children}</AcademyAuthContext.Provider>
  );
}

export function useAcademyAuth() {
  const ctx = useContext(AcademyAuthContext);
  if (!ctx) throw new Error("useAcademyAuth requires AcademyAuthProvider");
  return ctx;
}
