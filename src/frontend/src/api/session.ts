/**
 * Single owner of the credential storage keys.
 *
 * The access-token key stays `token` on purpose: renaming it would invalidate every
 * existing session for the sake of cosmetics. Anything that needs to read or drop the
 * session goes through here so `request.ts` and `authStore` cannot disagree — they used
 * to both write `localStorage` by hand, and one of them wiped it on a network blip.
 */
const ACCESS_KEY = 'token';
const REFRESH_KEY = 'refreshToken';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

export const session = {
  accessToken: (): string | null => localStorage.getItem(ACCESS_KEY),
  refreshToken: (): string | null => localStorage.getItem(REFRESH_KEY),

  save(accessToken: string, refreshToken: string | null): void {
    localStorage.setItem(ACCESS_KEY, accessToken);
    // Keep the old refresh token if the caller only rotated the access one.
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
  },

  clear(): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};
