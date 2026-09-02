import { useState } from "react";
import { api, ApiError } from "../api";

export function Login() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError("");
    try {
      await api.requestMagicLink(email);
      setStatus("sent");
    } catch (err) {
      setStatus("error");
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    }
  }

  if (status === "sent") {
    return (
      <div className="container">
        <h1>Check your email</h1>
        <p>We sent a sign-in link to {email}. It expires in 15 minutes and works once.</p>
      </div>
    );
  }

  return (
    <div className="container">
      <h1>Santregy</h1>
      <p className="meta">Sign in or create an account with just your email.</p>
      <form onSubmit={submit} style={{ maxWidth: 360, marginTop: 24 }}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ marginBottom: 12 }}
        />
        {error && <p className="error">{error}</p>}
        <button type="submit" className="primary" disabled={status === "sending"}>
          {status === "sending" ? "Sending..." : "Send sign-in link"}
        </button>
      </form>
    </div>
  );
}
