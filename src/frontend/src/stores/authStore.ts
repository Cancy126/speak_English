import { create } from 'zustand';
import * as authApi from '../api/auth';
import { errorMessage, isNetworkError } from '../api/request';
import { session } from '../api/session';
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

function signedIn(token: string, user: User) {
  return { token, user, isAuthenticated: true, isAdmin: user.is_admin, loading: false, error: null };
}

const signedOut = {
  token: null,
  user: null,
  isAuthenticated: false,
  isAdmin: false,
  loading: false,
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: session.accessToken(),
  loading: false,
  error: null,
  isAuthenticated: Boolean(session.accessToken()),
  isAdmin: false,

  // The request interceptor reads credentials straight out of storage, so the pair has
  // to be saved BEFORE the first authenticated call: saving after /auth/me made every
  // sign-in fetch the profile unauthenticated and die on 401.
  //
  // Failure deliberately does NOT clear the session. A wrong password, or the tunnel
  // blipping mid-request, has nothing to do with the credentials already in storage —
  // deleting them is what made the learner log in on every visit.
  login: async (email, password) => {
    set({ loading: true, error: null });
    try {
      const { access_token, refresh_token } = await authApi.login(email, password);
      session.save(access_token, refresh_token);
      const user = await authApi.fetchMe();
      set(signedIn(access_token, user));
      return true;
    } catch (err) {
      set({ loading: false, error: errorMessage(err) });
      return false;
    }
  },

  register: async (username, email, password) => {
    set({ loading: true, error: null });
    try {
      const { access_token, refresh_token } = await authApi.register(username, email, password);
      session.save(access_token, refresh_token);
      const user = await authApi.fetchMe();
      set(signedIn(access_token, user));
      return true;
    } catch (err) {
      set({ loading: false, error: errorMessage(err) });
      return false;
    }
  },

  // Token survives a refresh, but the profile does not, so re-pull it.
  loadCurrentUser: async () => {
    if (!session.accessToken()) return;
    set({ loading: true });
    try {
      const user = await authApi.fetchMe();
      // Re-read from storage: the interceptor may have rotated the access token while
      // this call was in flight, so get().token can already be stale here.
      set(signedIn(session.accessToken() ?? '', user));
    } catch (err) {
      if (isNetworkError(err)) {
        // Unreachable is not unauthorized: keep the session and let the next mount retry.
        set({ loading: false, error: '连不上服务器，稍后自动重试' });
        return;
      }
      session.clear();
      set({ ...signedOut });
    }
  },

  logout: () => {
    session.clear();
    set({ ...signedOut, error: null });
  },
}));
