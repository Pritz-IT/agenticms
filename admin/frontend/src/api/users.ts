import { api } from "./client";
import type { User } from "./types";

export function fetchUsers(): Promise<User[]> {
  return api<User[]>("/api/users");
}

export function createUser(data: Partial<User> & { password?: string }): Promise<User> {
  return api<User>("/api/users", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateUser(id: string, data: Partial<User> & { password?: string }): Promise<User> {
  return api<User>(`/api/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteUser(id: string): Promise<void> {
  return api<void>(`/api/users/${id}`, { method: "DELETE" });
}
