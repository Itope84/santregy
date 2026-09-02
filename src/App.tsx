import { useEffect, useState } from "react";
import { api, type User } from "./api";
import { Login } from "./pages/Login";
import { Home } from "./pages/Home";
import { Settings } from "./pages/Settings";

type Tab = "home" | "settings";

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined); // undefined = loading
  const [tab, setTab] = useState<Tab>("home");

  useEffect(() => {
    api.me().then(setUser, () => setUser(null));
  }, []);

  async function logout() {
    await api.logout();
    setUser(null);
  }

  if (user === undefined) return null;
  if (user === null) return <Login />;

  return (
    <>
      <header className="app-header">
        <strong>Santregy</strong>
        <nav className="app-nav">
          <button className={tab === "home" ? "active" : ""} onClick={() => setTab("home")}>
            Home
          </button>
          <button
            className={tab === "settings" ? "active" : ""}
            onClick={() => setTab("settings")}
          >
            Settings
          </button>
          <button onClick={logout}>Log out</button>
        </nav>
      </header>
      {tab === "home" ? <Home /> : <Settings user={user} onUpdated={setUser} />}
    </>
  );
}
