import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { AuthProvider } from "./auth/AuthProvider";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { AppShell } from "./components/AppShell";
import { AssetsPage } from "./pages/AssetsPage";
import { BuildsPage } from "./pages/BuildsPage";
import { CliApprovePage } from "./pages/CliApprovePage";
import { CliInstallPage } from "./pages/CliInstallPage";
import { LayoutsPage } from "./pages/LayoutsPage";
import { LocalesPage } from "./pages/LocalesPage";
import { LoginPage } from "./pages/LoginPage";
import { NavigationPage } from "./pages/NavigationPage";
import { PageEditorPage } from "./pages/PageEditorPage";
import { PagesListPage } from "./pages/PagesListPage";
import { SettingsPage } from "./pages/SettingsPage";
import { StagingAccessPage } from "./pages/StagingAccessPage";
import { UsersPage } from "./pages/UsersPage";
import { SubmissionsPage } from "./pages/SubmissionsPage";
import { legacySitePath } from "./site-routing";

const queryClient = new QueryClient();

function LegacyPageEditorRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`${legacySitePath("pages")}/${id ?? ""}`} replace />;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Public */}
            <Route path="/login" element={<LoginPage />} />

            {/* Protected — all authenticated users */}
            <Route
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to={legacySitePath("pages")} replace />} />
              <Route path="/pages" element={<Navigate to={legacySitePath("pages")} replace />} />
              <Route path="/pages/:id" element={<LegacyPageEditorRedirect />} />
              <Route path="/navigation" element={<Navigate to={legacySitePath("navigation")} replace />} />
              <Route path="/assets" element={<Navigate to={legacySitePath("assets")} replace />} />
              <Route path="/builds" element={<Navigate to={legacySitePath("builds")} replace />} />
              <Route path="/layouts" element={<Navigate to={legacySitePath("layouts")} replace />} />
              <Route path="/settings" element={<Navigate to={legacySitePath("settings")} replace />} />
              <Route path="/locales" element={<Navigate to={legacySitePath("locales")} replace />} />
              <Route path="/staging-access" element={<Navigate to={legacySitePath("staging-access")} replace />} />
              <Route path="/submissions" element={<Navigate to={legacySitePath("submissions")} replace />} />
              <Route path="/sites/:siteKey/pages" element={<PagesListPage />} />
              <Route path="/sites/:siteKey/pages/:id" element={<PageEditorPage />} />
              <Route path="/sites/:siteKey/navigation" element={<NavigationPage />} />
              <Route path="/sites/:siteKey/assets" element={<AssetsPage />} />
              <Route path="/sites/:siteKey/builds" element={<BuildsPage />} />
              <Route path="/sites/:siteKey/layouts" element={<LayoutsPage />} />
              <Route path="/sites/:siteKey/submissions" element={<SubmissionsPage />} />

              {/* Admin-only routes */}
              <Route
                path="/cli/approve/:deviceId"
                element={
                  <ProtectedRoute requiredRole="admin">
                    <CliApprovePage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/sites/:siteKey/cli"
                element={
                  <ProtectedRoute requiredRole="admin">
                    <CliInstallPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/sites/:siteKey/settings"
                element={
                  <ProtectedRoute requiredRole="admin">
                    <SettingsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/sites/:siteKey/locales"
                element={
                  <ProtectedRoute requiredRole="admin">
                    <LocalesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/sites/:siteKey/staging-access"
                element={
                  <ProtectedRoute requiredRole="admin">
                    <StagingAccessPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/users"
                element={
                  <ProtectedRoute requiredRole="admin">
                    <UsersPage />
                  </ProtectedRoute>
                }
              />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
