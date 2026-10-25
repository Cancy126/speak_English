import { FormEvent, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useI18n } from '../i18n';

export function RegisterPage() {
  const { register, isAuthenticated, loading, error } = useAuthStore();
  const { t } = useI18n();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (isAuthenticated) return <Navigate to="/" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await register(username, email, password);
  };

  return (
    <div className="mx-auto max-w-sm space-y-6 py-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">{t('register.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('register.subtitle')}</p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <label className="block space-y-1 text-sm">
          <span className="text-slate-600">{t('register.username')}</span>
          <input
            required
            minLength={2}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-500"
          />
        </label>
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
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-500"
          />
        </label>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-brand-600 py-2.5 font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? t('register.submitting') : t('register.submit')}
        </button>
      </form>

      <p className="text-center text-sm text-slate-500">
        {t('register.hasAccount')}{' '}
        <Link to="/login" className="text-brand-600 hover:underline">
          {t('register.signIn')}
        </Link>
      </p>
    </div>
  );
}
