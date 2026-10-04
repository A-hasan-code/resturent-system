import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { Shell } from "./Shell";
import { LoginPage } from "./pages/Login";
import { DashboardPage } from "./pages/Dashboard";
import { StorePage } from "./pages/Store";
import { RecipesPage } from "./pages/Recipes";
import { MenuPage } from "./pages/Menu";
import { BillsPage } from "./pages/Bills";
import { KitchenPage } from "./pages/Kitchen";
import { WaiterPage } from "./pages/Waiter";
import { SettingsPage } from "./pages/Settings";
import { UsersPage } from "./pages/Users";
import { PaymentsPage } from "./pages/Payments";
import { AuditPage } from "./pages/Audit";
import { HotelExpensesPage } from "./pages/HotelExpenses";
import { CloseReportPage } from "./pages/CloseReport";

function Private({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function Home() {
  const { user } = useAuth();
  if (user?.roleCode === "WAITER" || user?.roleCode === "SUPERVISOR") return <Navigate to="/waiter" replace />;
  return <DashboardPage />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <Private>
            <Shell />
          </Private>
        }
      >
        <Route index element={<Home />} />
        <Route path="waiter" element={<WaiterPage />} />
        <Route path="store" element={<StorePage />} />
        <Route path="recipes" element={<RecipesPage />} />
        <Route path="menu" element={<MenuPage />} />
        <Route path="orders" element={<Navigate to="/waiter" replace />} />
        <Route path="bills" element={<BillsPage />} />
        <Route path="kitchen" element={<KitchenPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="expenses" element={<HotelExpensesPage />} />
        <Route path="close" element={<CloseReportPage />} />
      </Route>
    </Routes>
  );
}
