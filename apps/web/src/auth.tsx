import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, type User } from "./api";
import { connectSocket } from "./socket";

type Session = { token: string; user: User };

type AuthCtx = {
  user: User | null;
  login: (username: string, password: string) => Promise<void>;
  loginWithPin: (userId: string, pin: string) => Promise<void>;
  logout: () => void;
  can: (...perms: string[]) => boolean;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem("user");
    return raw ? (JSON.parse(raw) as User) : null;
  });

  const start = useCallback((s: Session) => {
    localStorage.setItem("token", s.token);
    localStorage.setItem("user", JSON.stringify(s.user));
    setUser(s.user);
  }, []);

  const login = useCallback(
    async (username: string, password: string) => {
      start(await api<Session>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }));
    },
    [start]
  );

  const loginWithPin = useCallback(
    async (userId: string, pin: string) => {
      start(await api<Session>("/auth/pin", { method: "POST", body: JSON.stringify({ userId, pin }) }));
    },
    [start]
  );

  const logout = useCallback(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
  }, []);

  useEffect(() => {
    connectSocket(user ? localStorage.getItem("token") : null);
  }, [user]);

  // Role and permissions can change on the server (Users page); refresh the cached copy once per app start.
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    api<User>("/auth/me")
      .then((fresh) => {
        localStorage.setItem("user", JSON.stringify(fresh));
        setUser(fresh);
      })
      .catch(() => undefined);
  }, [userId]);

  useEffect(() => {
    const onUnauthorized = () => logout();
    window.addEventListener("hotel:unauthorized", onUnauthorized);
    return () => window.removeEventListener("hotel:unauthorized", onUnauthorized);
  }, [logout]);

  const can = useCallback(
    (...perms: string[]) =>
      !!user && perms.some((p) => user.permissions.includes(p)),
    [user]
  );

  const value = useMemo(
    () => ({ user, login, loginWithPin, logout, can }),
    [user, login, loginWithPin, logout, can]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("AuthProvider missing");
  return v;
}
