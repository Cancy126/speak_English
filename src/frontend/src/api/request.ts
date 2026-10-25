import axios, { AxiosError } from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';
import { session } from './session';
import type { TokenResponse } from '../types';

export const api = axios.create({
  baseURL: '/api',
  timeout: 60000,
});

api.interceptors.request.use((config) => {
  const token = session.accessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/** A request that already spent its single post-401 retry. */
type Retriable = InternalAxiosRequestConfig & { _retried?: boolean };

/**
 * `unreachable` is the case that caused the original bug report: a request that got no
 * response at all (tunnel blip, backend restarting) is NOT a dead session, and used to
 * be treated as one — the credentials were deleted and the learner had to log in again.
 */
type RefreshOutcome = 'renewed' | 'rejected' | 'unreachable';

let inflight: Promise<RefreshOutcome> | null = null;

async function attemptRefresh(): Promise<RefreshOutcome> {
  const refreshToken = session.refreshToken();
  if (!refreshToken) return 'rejected';
  try {
    // Bare axios on purpose: `api` carries the interceptor that is retrying us, which
    // would turn a failing refresh into unbounded recursion.
    const { data } = await axios.post<TokenResponse>(
      '/api/auth/refresh',
      { refresh_token: refreshToken },
      { timeout: 20000 },
    );
    session.save(data.access_token, data.refresh_token);
    return 'renewed';
  } catch (err) {
    if (!(err instanceof AxiosError) || !err.response) return 'unreachable';
    return 'rejected';
  }
}

/**
 * One refresh at a time. Without this, several requests that all 401 in the same tick
 * would each rotate the refresh token, and all but the last would then be presenting a
 * credential that the preceding response had already superseded.
 */
function refreshOnce(): Promise<RefreshOutcome> {
  inflight ??= attemptRefresh().finally(() => {
    inflight = null;
  });
  return inflight;
}

function signOut() {
  session.clear();
  // Hard redirect keeps the store out of the error path.
  if (!window.location.pathname.startsWith('/login')) {
    window.location.assign('/login');
  }
}

api.interceptors.response.use(undefined, async (error: AxiosError) => {
  const config = error.config as Retriable | undefined;
  // No response = transport-level failure: surface it and leave the session alone.
  if (!config || !error.response) return Promise.reject(error);
  // A wrong password is a 401 too; it must not trigger a refresh or a sign-out.
  if (error.response.status !== 401 || config._retried || config.url?.includes('/auth/')) {
    return Promise.reject(error);
  }

  const outcome = await refreshOnce();
  if (outcome === 'unreachable') return Promise.reject(error);
  if (outcome === 'rejected') {
    signOut();
    return Promise.reject(error);
  }

  config._retried = true;
  return api(config);
});

export function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.detail ?? error.message;
  }
  return error instanceof Error ? error.message : 'Unknown error';
}

/** True when the request never reached the server (offline, tunnel down, timeout). */
export function isNetworkError(error: unknown): boolean {
  return axios.isAxiosError(error) && !error.response;
}
