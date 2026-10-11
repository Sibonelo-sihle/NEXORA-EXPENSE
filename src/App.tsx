import { lazy, Suspense } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { MarketingLayout } from "./components/layout/MarketingLayout";
import { AppLayout } from "./components/layout/AppLayout";

import Home from "./pages/Home";
import Auth from "./pages/Auth";

const Dashboard = lazy(() => import("./pages/Dashboard"));
import Expenses from "./pages/Expenses";
import Receipts from "./pages/Receipts";
const Reports = lazy(() => import("./pages/Reports"));
import Settings from "./pages/Settings";

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { session, loading, isDemo } = useAuth();
  if (loading)
    return (
      <p className="p-8" role="status">
        Restoring your session…
      </p>
    );
  if (!session && !isDemo) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

function App() {
  return (
    <AuthProvider>
      <Router>
        <Suspense
          fallback={
            <p className="p-8" role="status">
              Loading…
            </p>
          }
        >
          <Routes>
            <Route element={<MarketingLayout />}>
              <Route path="/" element={<Home />} />
            </Route>
            <Route path="/login" element={<Auth mode="login" />} />
            <Route path="/forgot-password" element={<Auth mode="forgot" />} />
            <Route path="/reset-password" element={<Auth mode="reset" />} />
            <Route path="/signup" element={<Auth mode="signup" />} />

            <Route
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/expenses" element={<Expenses />} />
              <Route path="/receipts" element={<Receipts />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </Router>
    </AuthProvider>
  );
}

export default App;
