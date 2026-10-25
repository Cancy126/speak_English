import { FormEvent, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useI18n } from '../i18n';

export function LoginPage() {
  const { login, isAuthenticated, loading, error } = useAuthStore();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  if (isAuthenticated) return <Navigate to={from} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await login(email, password);
  };

  return (
    <div className="mx-auto max-w-sm space-y-6 py-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">{t('login.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('login.subtitle')}</p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <label className="block space-y-1 text-sm">
          <span className="text-slate-600">{t('login.email')}</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-500"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-slate-600">{t('login.password')}</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-500"
          />
        </label>

        {/* `error` is the API's own detail string (English); see 产品规划 3.1.7 — server
            messages still need error codes before they can be localised. */}
        {error && <p className="text-sm text-rose-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-brand-600 py-2.5 font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? t('login.submitting') : t('login.submit')}
        </button>
      </form>

      <p className="text-center text-sm text-slate-500">
        {t('login.noAccount')}{' '}
        <Link to="/register" className="text-brand-600 hover:underline">
          {t('login.createOne')}
        </Link>
      </p>
    </div>
  );
}
