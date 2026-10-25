import { Link, Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useI18n } from '../i18n';

export function Layout({ children, requireAuth = true }: { children: ReactNode; requireAuth?: boolean }) {
  const { isAuthenticated, user, logout } = useAuth();
  const { lang, toggleLang, t } = useI18n();
  const location = useLocation();

  if (requireAuth && !isAuthenticated) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/85 backdrop-blur">
        <nav className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold text-brand-700">
            <span aria-hidden>🗣️</span>
            <span>{t('brand.name')}</span>
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <Link to="/history" className="text-slate-600 hover:text-brand-600">
              {t('nav.history')}
            </Link>
            {user?.is_admin && (
              <Link to="/admin" className="text-slate-600 hover:text-brand-600">
                {t('nav.admin')}
              </Link>
            )}
            {/* Bilingual by design: this button always reads as the language you would
                switch *to*, so it needs no explanation in either language. */}
            <button
              type="button"
              onClick={toggleLang}
              aria-label={`${t('lang.label')}: ${lang === 'zh' ? 'English' : '中文'}`}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              {t('lang.switch')}
            </button>
            {isAuthenticated ? (
              <button
                type="button"
                onClick={logout}
                className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100"
              >
                {t('nav.signOut')}
              </button>
            ) : (
              <Link to="/login" className="text-brand-600">
                {t('nav.signIn')}
              </Link>
            )}
          </div>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">{children}</main>
      <footer className="border-t border-slate-200 py-3 text-center text-xs text-slate-400">
        {t('nav.tagline')}
      </footer>
    </div>
  );
}
