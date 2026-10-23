import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';

/** Pulls the profile once on mount so a page refresh keeps the session. */
export function useAuth() {
  const store = useAuthStore();

  useEffect(() => {
    if (store.token && !store.user) void store.loadCurrentUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return store;
}
