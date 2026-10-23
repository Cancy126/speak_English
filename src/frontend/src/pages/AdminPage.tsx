import { FormEvent, useEffect, useState } from 'react';
import { addUser, deleteUser, listUsers, resetPassword } from '../api/admin';
import { errorMessage } from '../api/request';
import type { User } from '../types';

/** 产品规划 3.4: admin can add, delete and reset passwords for users. */
export function AdminPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState({ username: '', email: '', password: '', is_admin: false });
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => listUsers().then(setUsers).catch((e) => setError(errorMessage(e)));

  useEffect(() => {
    void refresh();
  }, []);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await addUser(form);
      setForm({ username: '', email: '', password: '', is_admin: false });
      setFeedback('User created');
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const remove = async (user: User) => {
    if (!window.confirm(`Delete ${user.email}? Their history goes too.`)) return;
    setError(null);
    try {
      await deleteUser(user.id);
      setFeedback(`Deleted ${user.username}`);
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const reset = async (user: User) => {
    const next = window.prompt(`New password for ${user.username} (min 6 chars):`);
    if (!next || next.length < 6) return;
    setError(null);
    try {
      await resetPassword(user.id, next);
      setFeedback(`Password reset for ${user.username}`);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="space-y-6 py-4">
      <h1 className="text-xl font-bold text-slate-800">User management</h1>

      <form onSubmit={create} className="grid gap-2 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <input
          placeholder="Username"
          required
          minLength={2}
          value={form.username}
          onChange={(e) => setForm({ ...form, username: e.target.value })}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
        <input
          placeholder="Email"
          type="email"
          required
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
        <input
          placeholder="Password"
          type="password"
          required
          minLength={6}
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={form.is_admin}
              onChange={(e) => setForm({ ...form, is_admin: e.target.checked })}
            />
            Admin
          </label>
          <button
            type="submit"
            className="ml-auto rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Add user
          </button>
        </div>
      </form>

      {feedback && <p className="text-sm text-emerald-600">{feedback}</p>}
      {error && <p className="text-sm text-rose-600">{error}</p>}

      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {users.map((user) => (
          <li key={user.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-slate-700">
                {user.username}
                {user.is_admin && (
                  <span className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 text-xs text-brand-700">
                    admin
                  </span>
                )}
              </span>
              <span className="text-xs text-slate-400">{user.email}</span>
            </span>
            <span className="flex shrink-0 gap-2 text-xs">
              <button
                type="button"
                onClick={() => reset(user)}
                className="rounded-md border border-slate-300 px-2 py-1 hover:bg-slate-50"
              >
                Reset password
              </button>
              <button
                type="button"
                onClick={() => remove(user)}
                className="rounded-md border border-rose-200 px-2 py-1 text-rose-600 hover:bg-rose-50"
              >
                Delete
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
