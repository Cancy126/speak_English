import { Link, Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../hooks/useAuth';

export function Layout({ children, requireAuth = true }: { children: ReactNode; requireAuth?: boolean }) {
  const { isAuthenticated, user, logout } = useAuth();
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
            <span>Speak English</span>
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <Link to="/history" className="text-slate-600 hover:text-brand-600">
              History
            </Link>
            {user?.is_admin && (
              <Link to="/admin" className="text-slate-600 hover:text-brand-600">
                Admin
              </Link>
            )}
            {isAuthenticated ? (
              <button
                type="button"
                onClick={logout}
                className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100"
              >
                Sign out
              </button>
            ) : (
              <Link to="/login" className="text-brand-600">
                Sign in
              </Link>
            )}
          </div>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">{children}</main>
      <footer className="border-t border-slate-200 py-3 text-center text-xs text-slate-400">
        Practise out loud — your voice is the exercise.
      </footer>
    </div>
  );
}
