import { api } from './request';
import type { User } from '../types';

export async function listUsers(): Promise<User[]> {
  const { data } = await api.get<User[]>('/admin/users');
  return data;
}

export async function addUser(payload: {
  username: string;
  email: string;
  password: string;
  is_admin: boolean;
}): Promise<User> {
  const { data } = await api.post<User>('/admin/users', payload);
  return data;
}

export async function deleteUser(userId: number): Promise<void> {
  await api.delete(`/admin/users/${userId}`);
}

export async function resetPassword(userId: number, newPassword: string): Promise<void> {
  await api.put(`/admin/users/${userId}/reset-password`, null, {
    params: { new_password: newPassword },
  });
}
