import { useState } from "react";
import { AdminLogin } from "./AdminLogin";
import { AdminDashboard } from "./AdminDashboard";
import { AdminUsers } from "./AdminUsers";
import { AdminPressMonitor } from "./AdminPressMonitor";
import { AdminKeyTestTool } from "./AdminKeyTestTool";
import { AdminInquiries } from "./AdminInquiries";

export function AdminPage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [view, setView] = useState<"dashboard" | "users" | "monitor" | "keytest" | "inquiries">("dashboard");
  const [monitorTarget, setMonitorTarget] = useState<{ userId: number; nickname: string } | null>(null);

  function handleUnauthorized() {
    setLoggedIn(false);
    setView("dashboard");
  }

  if (!loggedIn) {
    return <AdminLogin onSuccess={() => setLoggedIn(true)} />;
  }

  if (view === "keytest") {
    return <AdminKeyTestTool onBack={() => setView("dashboard")} />;
  }

  if (view === "inquiries") {
    return <AdminInquiries onUnauthorized={handleUnauthorized} onBack={() => setView("dashboard")} />;
  }

  if (view === "monitor" && monitorTarget) {
    return (
      <AdminPressMonitor
        userId={monitorTarget.userId}
        nickname={monitorTarget.nickname}
        onBack={() => setView("users")}
      />
    );
  }

  if (view === "users") {
    return (
      <AdminUsers
        onUnauthorized={handleUnauthorized}
        onBack={() => setView("dashboard")}
        onOpenMonitor={(userId, nickname) => {
          setMonitorTarget({ userId, nickname });
          setView("monitor");
        }}
      />
    );
  }

  return (
    <AdminDashboard
      onUnauthorized={handleUnauthorized}
      onOpenUsers={() => setView("users")}
      onOpenKeyTest={() => setView("keytest")}
      onOpenInquiries={() => setView("inquiries")}
    />
  );
}
