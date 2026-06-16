import React from "react";
import { CircleUserRound } from "lucide-react";
import { useAuth } from "../auth/useAuth";

interface TopBarProps {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}

export function TopBar({ title, subtitle, children }: TopBarProps) {
  const { user } = useAuth();

  return (
    <header className="shrink-0 max-h-[600px] border-b border-zinc-800/90 bg-zinc-950/62 px-5 py-5 backdrop-blur sm:px-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300/80">
            AgentiCMS admin
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>}
        </div>
        {children && (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            {children}
          </div>
        )}
        {user && (
          <div className="ml-1 hidden items-center gap-3 rounded-lg border border-zinc-800/80 bg-zinc-900/55 px-3 py-2 text-right sm:flex">
            <div>
              <p className="max-w-48 truncate text-sm font-medium text-zinc-200">{user.email}</p>
              <p className="text-xs capitalize text-zinc-500">{user.role}</p>
            </div>
            <CircleUserRound className="h-5 w-5 text-zinc-500" strokeWidth={1.7} />
          </div>
        )}
      </div>
    </header>
  );
}
