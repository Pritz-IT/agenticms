import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { toastError } from "../lib/toast-error";
import { TopBar } from "../components/TopBar";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { createUser, deleteUser, fetchUsers, updateUser } from "../api/users";
import { useAuth } from "../auth/useAuth";
import type { User } from "../api/types";

export function UsersPage() {
  const qc = useQueryClient();
  const { user: currentUser } = useAuth();

  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"editor" | "admin">("editor");

  const usersQuery = useQuery({ queryKey: ["users"], queryFn: fetchUsers });

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setNewEmail("");
      setNewPassword("");
      setNewRole("editor");
      toast.success("User created");
    },
    onError: (err) => {
      toastError("Failed to create user", err);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.success("User deleted");
    },
    onError: (err) => {
      toastError("Failed to delete user", err);
    },
  });

  // Inline edit (email / role / optional new password). Editing yourself —
  // including your own password — is allowed (only self-delete is blocked).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState<"editor" | "admin">("editor");
  const [editPassword, setEditPassword] = useState("");

  function startEdit(u: User) {
    setEditingId(u.id);
    setEditEmail(u.email);
    setEditRole(u.role as "editor" | "admin");
    setEditPassword("");
  }
  function cancelEdit() {
    setEditingId(null);
    setEditPassword("");
  }

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: { email?: string; role?: "editor" | "admin"; password?: string };
    }) => updateUser(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      cancelEdit();
      toast.success("User updated");
    },
    onError: (err) => {
      toastError("Failed to update user", err);
    },
  });

  function handleSaveEdit(id: string) {
    const data: { email?: string; role?: "editor" | "admin"; password?: string } = {
      email: editEmail.trim(),
      role: editRole,
    };
    // Blank password field = keep the current password unchanged.
    if (editPassword.trim()) data.password = editPassword;
    updateMutation.mutate({ id, data });
  }

  const users = usersQuery.data ?? [];

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail.trim() || !newPassword.trim()) return;
    createMutation.mutate({ email: newEmail.trim(), password: newPassword, role: newRole });
  }

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Users" subtitle="Manage admin users" />

      <div className="flex-1 overflow-auto p-6 flex flex-col gap-6">
        {usersQuery.isLoading ? (
          <p className="text-neutral-500">Loading…</p>
        ) : usersQuery.isError ? (
          <p className="text-red-400">Failed to load users.</p>
        ) : (
          <div className="border border-neutral-700 rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-neutral-800 text-neutral-400 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-3">Email</th>
                  <th className="text-left px-4 py-3">Role</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-neutral-500">
                      No users found.
                    </td>
                  </tr>
                ) : (
                  users.map((u: User) => {
                    const isCurrentUser = currentUser?.id === u.id;
                    const isEditing = editingId === u.id;

                    if (isEditing) {
                      return (
                        <tr key={u.id} className="bg-neutral-800/60">
                          <td className="px-4 py-3">
                            <input
                              type="email"
                              value={editEmail}
                              onChange={(e) => setEditEmail(e.target.value)}
                              className="bg-neutral-900 border border-neutral-600 text-white rounded px-3 py-1.5 text-sm w-56 focus:outline-none focus:border-blue-500"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <Select
                              value={editRole}
                              onValueChange={(value) =>
                                setEditRole(value as "editor" | "admin")
                              }
                            >
                              <SelectTrigger className="w-32">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectGroup>
                                  <SelectItem value="editor">editor</SelectItem>
                                  <SelectItem value="admin">admin</SelectItem>
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-2">
                              <input
                                type="password"
                                value={editPassword}
                                onChange={(e) => setEditPassword(e.target.value)}
                                placeholder="new password (blank = keep)"
                                className="bg-neutral-900 border border-neutral-600 text-white rounded px-3 py-1.5 text-sm w-56 focus:outline-none focus:border-blue-500"
                              />
                              <button
                                onClick={() => handleSaveEdit(u.id)}
                                disabled={updateMutation.isPending || !editEmail.trim()}
                                className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded"
                              >
                                {updateMutation.isPending ? "Saving…" : "Save"}
                              </button>
                              <button
                                onClick={cancelEdit}
                                disabled={updateMutation.isPending}
                                className="px-3 py-1.5 text-sm text-neutral-400 hover:text-neutral-200 disabled:opacity-50"
                              >
                                Cancel
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    return (
                      <tr key={u.id} className="hover:bg-neutral-800/50 transition-colors">
                        <td className="px-4 py-3 text-white">
                          {u.email}
                          {isCurrentUser && (
                            <span className="ml-2 text-xs text-neutral-500">(you)</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs border capitalize ${
                              u.role === "admin"
                                ? "bg-blue-900 text-blue-300 border-blue-700"
                                : "bg-neutral-700 text-neutral-300 border-neutral-600"
                            }`}
                          >
                            {u.role}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-3">
                            <button
                              onClick={() => startEdit(u)}
                              className="text-xs text-blue-400 hover:text-blue-300"
                            >
                              Edit
                            </button>
                            {!isCurrentUser && (
                              <button
                                onClick={() => {
                                  if (confirm(`Delete user "${u.email}"?`)) {
                                    deleteMutation.mutate(u.id);
                                  }
                                }}
                                disabled={deleteMutation.isPending}
                                className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        <form
          onSubmit={handleAdd}
          className="bg-neutral-800 border border-neutral-700 rounded p-4 flex flex-wrap items-end gap-3"
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-400 uppercase tracking-wider">Email</label>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="user@example.com"
              className="bg-neutral-900 border border-neutral-600 text-white rounded px-3 py-1.5 text-sm w-52 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-400 uppercase tracking-wider">Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
              className="bg-neutral-900 border border-neutral-600 text-white rounded px-3 py-1.5 text-sm w-40 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-neutral-400 uppercase tracking-wider">Role</label>
            <Select
              value={newRole}
              onValueChange={(value) => setNewRole(value as "editor" | "admin")}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="editor">editor</SelectItem>
                  <SelectItem value="admin">admin</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <button
            type="submit"
            disabled={createMutation.isPending || !newEmail.trim() || !newPassword.trim()}
            className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded"
          >
            {createMutation.isPending ? "Adding…" : "Add"}
          </button>
          {createMutation.isError && (
            <p className="text-red-400 text-sm w-full">{String(createMutation.error)}</p>
          )}
        </form>
      </div>
    </div>
  );
}
