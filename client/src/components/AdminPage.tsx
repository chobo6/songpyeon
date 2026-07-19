import { useState } from "react";
import { AdminLogin } from "./AdminLogin";
import { AdminDashboard } from "./AdminDashboard";

export function AdminPage() {
  const [loggedIn, setLoggedIn] = useState(false);

  if (!loggedIn) {
    return <AdminLogin onSuccess={() => setLoggedIn(true)} />;
  }

  return <AdminDashboard onUnauthorized={() => setLoggedIn(false)} />;
}
