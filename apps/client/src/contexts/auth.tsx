import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  GithubAuthProvider,
  GoogleAuthProvider,
  onIdTokenChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { auth } from "@/utils/firebase/client";
import { setAuthToken } from "@/utils/api";

interface AuthContextValue {
  user: User | null;
  token: string | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithGitHub: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onIdTokenChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const jwt = await firebaseUser.getIdToken();
        setUser(firebaseUser);
        setToken(jwt);
        setAuthToken(jwt);
      } else {
        setUser(null);
        setToken(null);
        setAuthToken(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const postLogin = async (idToken: string) => {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: idToken }),
    });
    if (!res.ok) throw new Error("Failed to create session");
  };

  const signInWithGoogle = async () => {
    const result = await signInWithPopup(auth, new GoogleAuthProvider());
    const idToken = await result.user.getIdToken();
    await postLogin(idToken);
  };

  const signInWithGitHub = async () => {
    const result = await signInWithPopup(auth, new GithubAuthProvider());
    const idToken = await result.user.getIdToken();
    await postLogin(idToken);
  };

  const signOut = async () => {
    await fetch("/api/logout", { method: "POST" });
    await firebaseSignOut(auth);
  };

  return (
    <AuthContext.Provider
      value={{ user, token, loading, signInWithGoogle, signInWithGitHub, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
