import { Outlet } from "react-router-dom";
import { Toaster } from "sonner";
import { Sidebar } from "./Sidebar";

export function AppShell() {
  return (
    <div className="flex min-h-[100dvh] overflow-hidden bg-[radial-gradient(circle_at_20%_0%,rgba(8,145,178,0.13),transparent_34%),linear-gradient(135deg,#09090b_0%,#111113_48%,#09090b_100%)] text-zinc-100">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-auto">
        <Outlet />
      </main>
      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          style: {
            background: "#18181b",
            border: "1px solid #27272a",
            color: "#e4e4e7",
          },
        }}
      />
    </div>
  );
}
