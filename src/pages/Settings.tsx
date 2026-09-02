import { useState } from "react";
import { api, ApiError, type User } from "../api";

export function Settings({ user, onUpdated }: { user: User; onUpdated: (u: User) => void }) {
  const [email, setEmail] = useState(user.email);
  const [anniversaryDate, setAnniversaryDate] = useState(user.anniversaryDate);
  const [xValue, setXValue] = useState(user.xValue.toString());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const [month, day] = anniversaryDate.split("-");

  function setAnniversary(nextMonth: string, nextDay: string) {
    setAnniversaryDate(`${nextMonth.padStart(2, "0")}-${nextDay.padStart(2, "0")}`);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const updated = await api.updateSettings({
        email,
        anniversaryDate,
        xValue: Number(xValue),
      });
      onUpdated(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container">
      <h1>Settings</h1>
      <form className="settings-form" onSubmit={submit}>
        <div>
          <label htmlFor="settings-email">Email</label>
          <input
            id="settings-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div>
          <label>Anniversary date (month / day)</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="number"
              min="1"
              max="12"
              required
              value={month}
              onChange={(e) => setAnniversary(e.target.value, day)}
            />
            <input
              type="number"
              min="1"
              max="31"
              required
              value={day}
              onChange={(e) => setAnniversary(month, e.target.value)}
            />
          </div>
          <p className="meta">Picks are emailed to you every year on this date (UTC).</p>
        </div>

        <div>
          <label htmlFor="settings-x">Number of picks (X)</label>
          <input
            id="settings-x"
            type="number"
            min="1"
            max="10"
            required
            value={xValue}
            onChange={(e) => setXValue(e.target.value)}
          />
          <p className="meta">1–10. The screen also shows 5 alternates below your picks.</p>
        </div>

        {error && <p className="error">{error}</p>}
        {saved && <p className="meta">Saved.</p>}
        <button type="submit" className="primary" disabled={saving}>
          {saving ? "Saving..." : "Save settings"}
        </button>
      </form>
    </div>
  );
}
