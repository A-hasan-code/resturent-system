import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { Shell } from "./Shell";
import { LoginPage } from "./pages/Login";
import { DashboardPage } from "./pages/Dashboard";
import { StorePage } from "./pages/Store";
import { RecipesPage } from "./pages/Recipes";
import { MenuPage } from "./pages/Menu";
import { OrdersPage } from "./pages/Orders";
import { BillsPage } from "./pages/Bills";
import { KitchenPage } from "./pages/Kitchen";

function Private({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
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
        <Route index element={<DashboardPage />} />
        <Route path="store" element={<StorePage />} />
        <Route path="recipes" element={<RecipesPage />} />
        <Route path="menu" element={<MenuPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="bills" element={<BillsPage />} />
        <Route path="kitchen" element={<KitchenPage />} />
      </Route>
    </Routes>
  );
}
