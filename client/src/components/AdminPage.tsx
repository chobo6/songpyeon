import { useState } from "react";
import { AdminLogin } from "./AdminLogin";
import { AdminDashboard } from "./AdminDashboard";
import { AdminUsers } from "./AdminUsers";

export function AdminPage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [view, setView] = useState<"dashboard" | "users">("dashboard");

  function handleUnauthorized() {
    setLoggedIn(false);
    setView("dashboard");
  }

  if (!loggedIn) {
    return <AdminLogin onSuccess={() => setLoggedIn(true)} />;
  }

  if (view === "users") {
    return <AdminUsers onUnauthorized={handleUnauthorized} onBack={() => setView("dashboard")} />;
  }

  return <AdminDashboard onUnauthorized={handleUnauthorized} onOpenUsers={() => setView("users")} />;
}
