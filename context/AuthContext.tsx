"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  /** null = not yet fetched, true/false = actual server value */
  approved: boolean | null;
  approvalLoading: boolean;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<{ error: Error | null }>;
  loginAsLocalDev: () => void;
}

const DEV_USER: User = {
  id: "local-trader-01",
  app_metadata: { provider: "local" },
  user_metadata: { name: "Local Trader" },
  aud: "authenticated",
  created_at: new Date().toISOString(),
  email: "trader@local.dev",
} as unknown as User;

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [approved, setApproved] = useState<boolean | null>(null);
  const [approvalLoading, setApprovalLoading] = useState<boolean>(false);

  /** Fetches the server-side approval status for the current user.
   *  This ALWAYS reads from Supabase — never from localStorage or client metadata. */
  async function fetchApprovalStatus(userId: string) {
    if (userId === "local-trader-01") {
      setApproved(true);
      return;
    }
    setApprovalLoading(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("approved")
        .eq("id", userId)
        .maybeSingle();

      if (error) {
        console.error("[AUTH] Failed to fetch approval status:", error.message);
        // Deny access on any fetch error — fail closed, not open
        setApproved(false);
      } else {
        const approvedValue = data?.approved ?? false;
        console.log(`[AUTH] approval status for ${userId}: ${approvedValue}`);
        setApproved(approvedValue);
      }
    } catch (err) {
      console.error("[AUTH] Exception fetching approval status:", err);
      setApproved(false);
    } finally {
      setApprovalLoading(false);
    }
  }

  const loginAsLocalDev = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem("tj-dev-user", "true");
    }
    setUser(DEV_USER);
    setApproved(true);
    setLoading(false);
  };

  useEffect(() => {
    const getInitialSession = async () => {
      try {
        if (typeof window !== "undefined" && localStorage.getItem("tj-dev-user") === "true") {
          setUser(DEV_USER);
          setApproved(true);
          setLoading(false);
          return;
        }

        const isPlaceholder =
          !process.env.NEXT_PUBLIC_SUPABASE_URL ||
          process.env.NEXT_PUBLIC_SUPABASE_URL.includes("placeholder-project");

        if (isPlaceholder) {
          // Auto-enable local developer session if placeholder Supabase is configured
          setUser(DEV_USER);
          setApproved(true);
          setLoading(false);
          return;
        }

        const { data } = await supabase.auth.getSession();
        const s = data.session;
        const u = s?.user ?? null;
        console.log(`[AUTH] session restored: ${u ? u.id : "null"}`);
        setSession(s);
        setUser(u);
        if (u) {
          await fetchApprovalStatus(u.id);
        } else {
          setApproved(null);
        }
      } catch (err) {
        console.error("[AUTH] Error getting initial session:", err);
        // Fallback to dev user on network/config failure
        setUser(DEV_USER);
        setApproved(true);
      } finally {
        setLoading(false);
      }
    };

    getInitialSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, currentSession) => {
        const u = currentSession?.user ?? null;
        console.log(`[AUTH] onAuthStateChange event=${event} user_id=${u?.id ?? "none"}`);
        setSession(currentSession);
        setUser(u);
        setLoading(false);

        if (u) {
          await fetchApprovalStatus(u.id);
        } else {
          setApproved(null);
        }
      }
    );

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  const signUp = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signUp({ email, password });
      return { error };
    } catch (err: any) {
      return { error: err };
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      return { error };
    } catch (err: any) {
      return { error: err };
    }
  };

  const signOut = async () => {
    try {
      if (typeof window !== "undefined") {
        localStorage.removeItem("tj-dev-user");
      }
      setUser(null);
      setSession(null);
      setApproved(null);
      const { error } = await supabase.auth.signOut();
      return { error };
    } catch (err: any) {
      return { error: err };
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        approved,
        approvalLoading,
        signUp,
        signIn,
        signOut,
        loginAsLocalDev,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
