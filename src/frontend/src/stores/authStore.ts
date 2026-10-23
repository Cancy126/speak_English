import { create } from 'zustand';
import * as authApi from '../api/auth';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  isAdmin: boolean;

  login: (email: string, password: string) => Promise<boolean>;
  register: (username: string, email: string, password: string) => Promise<boolean>;
  loadCurrentUser: () => Promise<void>;
  logout: () => void;
}

// The axios request interceptor reads the token straight out of localStorage, so
// it has to be persisted BEFORE the first authenticated call. Writing it only
// after fetchMe meant every sign-in fetched /auth/me unauthenticated and died on 401.
function sessionPatch(token: string, user: User) {
  return { token, user, isAuthenticated: true, isAdmin: user.is_admin, loading: false };
}

const signedOut = {
  token: null,
  user: null,
  isAuthenticated: false,
  isAdmin: false,
  loading: false,
};

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: localStorage.getItem('token'),
  loading: false,
  error: null,
  isAuthenticated: Boolean(localStorage.getItem('token')),
  isAdmin: false,

  login: async (email, password) => {
    set({ loading: true, error: null });
    try {
      const { access_token } = await authApi.login(email, password);
      localStorage.setItem('token', access_token);
      const user = await authApi.fetchMe();
      set(sessionPatch(access_token, user));
      return true;
    } catch (err) {
      localStorage.removeItem('token');
      set({ ...signedOut, error: errMessage(err) });
      return false;
    }
  },

  register: async (username, email, password) => {
    set({ loading: true, error: null });
    try {
      const { access_token } = await authApi.register(username, email, password);
      localStorage.setItem('token', access_token);
      const user = await authApi.fetchMe();
      set(sessionPatch(access_token, user));
      return true;
    } catch (err) {
      localStorage.removeItem('token');
      set({ ...signedOut, error: errMessage(err) });
      return false;
    }
  },

  // Token survives a refresh, but the profile does not, so re-pull it.
  loadCurrentUser: async () => {
    if (!get().token) return;
    set({ loading: true });
    try {
      const user = await authApi.fetchMe();
      set({ user, isAdmin: user.is_admin, isAuthenticated: true, loading: false });
    } catch {
      localStorage.removeItem('token');
      set({ ...signedOut });
    }
  },

  logout: () => {
    localStorage.removeItem('token');
    set({ ...signedOut, error: null });
  },
}));

function errMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const res = (err as { response?: { data?: { detail?: string } } }).response;
    if (res?.data?.detail) return res.data.detail;
  }
  return err instanceof Error ? err.message : 'Request failed';
}
