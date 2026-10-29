import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Shell } from "./components/Shell";
import { PageLoader } from "./components/ui";
import { useAuth } from "./lib/auth";
import Activity from "./pages/Activity";
import Admin from "./pages/Admin";
import Customers from "./pages/Customers";
import Dashboard from "./pages/Dashboard";
import Inventory from "./pages/Inventory";
import Landing from "./pages/Landing";
import { Login, Signup } from "./pages/Auth";
import Munshi from "./pages/Munshi";
import Onboarding from "./pages/Onboarding";
import SettingsPage from "./pages/Settings";
import Suppliers from "./pages/Suppliers";
import Udhaar from "./pages/Udhaar";

function RequireAuth({ children, admin }: { children: React.ReactNode; admin?: boolean }) {
  const { session, loading, isAdmin, loggedOutByUser } = useAuth();
  const loc = useLocation();
  if (loading) return <PageLoader />;
  if (!session) return loggedOutByUser ? <Navigate to="/" replace /> : <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (admin && !isAdmin) return <Navigate to="/app" replace />;
  if (!isAdmin && !session.shop.onboarded && loc.pathname !== "/onboarding") return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />
      <Route path="/app" element={<RequireAuth><Shell /></RequireAuth>}>
        <Route index element={<Dashboard />} />
        <Route path="munshi" element={<Munshi />} />
        <Route path="activity" element={<Activity />} />
        <Route path="udhaar" element={<Udhaar />} />
        <Route path="stock" element={<Inventory />} />
        <Route path="customers" element={<Customers />} />
        <Route path="suppliers" element={<Suppliers />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="admin" element={<RequireAuth admin><Admin /></RequireAuth>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
