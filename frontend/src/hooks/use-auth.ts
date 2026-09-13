"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";

import {
  authApi,
  type ChangePasswordPayload,
  type LoginPayload,
  type ProfilePayload,
  type RegisterPayload,
} from "@/lib/api/endpoints";
import { authStore, setSession, updateSessionUser } from "@/lib/auth/session";

export function useAuth() {
  const { status, user, reason } = useSyncExternalStore(
    authStore.subscribe,
    authStore.getSnapshot,
    authStore.getServerSnapshot,
  );
  const queryClient = useQueryClient();

  const login = useCallback(async (payload: LoginPayload) => {
    const session = await authApi.login(payload);
    setSession(session);
    return session.user;
  }, []);

  /** Sign in with a texted code (a number we haven't seen before becomes a new account). */
  const signInWithPhone = useCallback(async (phone: string, code: string) => {
    const session = await authApi.verifyPhoneCode(phone, code);
    setSession(session);
    return session;
  }, []);

  const register = useCallback(async (payload: RegisterPayload) => {
    const session = await authApi.register(payload);
    setSession(session);
    return session.user;
  }, []);

  const updateProfile = useCallback(async (payload: ProfilePayload) => {
    const user = await authApi.updateProfile(payload);
    updateSessionUser(user);
    return user;
  }, []);

  const changePassword = useCallback(async (payload: ChangePasswordPayload) => {
    // The old tokens die with the old password, so the API hands back a fresh session.
    const session = await authApi.changePassword(payload);
    setSession(session);
    return session.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Even if the API is unreachable, drop the local session; the cookie expires on its own.
    } finally {
      setSession(null, "logout");
      queryClient.clear();
    }
  }, [queryClient]);

  return {
    status,
    user,
    reason,
    isAuthenticated: status === "authenticated",
    login,
    signInWithPhone,
    register,
    logout,
    updateProfile,
    changePassword,
  };
}
