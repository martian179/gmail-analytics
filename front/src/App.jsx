import { useEffect, useMemo, useState } from "react";

const PROD_API_BASE_URL = "https://gmail-analytics.onrender.com";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? "http://localhost:3001" : PROD_API_BASE_URL);


const EMPTY_ANALYTICS = {
  summary: null,
  topSenders: [],
  labelCounts: [],
  weekdayCounts: [],
  recentMessages: [],
};

function formatNumber(value) {
  return new Intl.NumberFormat().format(value ?? 0);
}

function formatDate(value) {
  return new Date(value).toLocaleString();
}

async function apiFetch(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    ...options,
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

function MetricCard({ label, value, note }) {
  return (
    <article className="metric-card">
      <p className="metric-label">{label}</p>
      <p className="metric-value">
        {typeof value === "number" ? formatNumber(value) : value}
      </p>
      <p className="metric-note">{note}</p>
    </article>
  );
}

function ListPanel({ title, subtitle, items }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </div>
      <div className="simple-list">
        {items.length === 0 ? (
          <p className="empty-state">No data yet.</p>
        ) : (
          items.map((item) => (
            <div key={item.label} className="simple-list-item">
              <strong title={item.label}>{item.label}</strong>
              <span>{formatNumber(item.value)}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function WeekdayPanel({ rows }) {
  const max = Math.max(...rows.map((row) => row.value), 1);

  return (
    <section className="panel panel-wide">
      <div className="panel-header">
        <div>
          <h2>Emails By Weekday</h2>
          <p>Volume across the current 50-message sample</p>
        </div>
      </div>
      <div className="weekday-bars">
        {rows.map((row) => (
          <div key={row.label} className="weekday-row">
            <span className="weekday-name">{row.label}</span>
            <div className="weekday-track">
              <div
                className="weekday-fill"
                style={{ width: `${(row.value / max) * 100}%` }}
              />
            </div>
            <span className="weekday-value">{row.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function RecentMessagesTable({ rows }) {
  return (
    <section className="panel panel-wide">
      <div className="panel-header">
        <div>
          <h2>Recent Messages</h2>
          <p>Latest emails included in the analytics run</p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>From</th>
              <th>Subject</th>
              <th>Labels</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan="4" className="empty-table">
                  No messages loaded yet.
                </td>
              </tr>
            ) : (
              rows.map((message) => (
                <tr key={message.id}>
                  <td>{formatDate(message.date)}</td>
                  <td className="table-email">{message.from || "-"}</td>
                  <td>{message.subject}</td>
                  <td>{message.labels.join(", ")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function App() {
  const [session, setSession] = useState({
    authenticated: false,
    email: "",
  });
  const [analytics, setAnalytics] = useState(EMPTY_ANALYTICS);
  const [status, setStatus] = useState({
    message: "Connect Gmail to load your latest 50-message analytics snapshot.",
    isError: false,
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;

    async function loadSession() {
      try {
        const payload = await apiFetch("/auth/session");
        if (!alive) return;

        setSession({
          authenticated: payload.authenticated,
          email: payload.email || "",
        });

        setStatus({
          message: payload.authenticated
            ? `Connected${payload.email ? ` as ${payload.email}` : ""}. Load analytics when you are ready.`
            : "Connect Gmail to load your latest 50-message analytics snapshot.",
          isError: false,
        });
      } catch (error) {
        if (!alive) return;

        setStatus({
          message: error.message,
          isError: true,
        });
      }
    }

    loadSession();

    return () => {
      alive = false;
    };
  }, []);

  const metrics = useMemo(() => {
    if (!analytics.summary) {
      return [];
    }

    return [
      ["Fetched", analytics.summary.fetchedCount, "Latest Gmail sample"],
      ["Received", analytics.summary.receivedCount, "Non-sent messages"],
      ["Sent", analytics.summary.sentCount, "Messages from you"],
      ["Unread", analytics.summary.unreadCount, "Still unread"],
      ["Unique senders", analytics.summary.uniqueSendersCount, "Distinct email addresses"],
      ["Attachments", analytics.summary.attachmentCount, "Messages with files"],
      ["Starred", analytics.summary.starredCount, "Starred messages"],
      ["Important", analytics.summary.importantCount, "Important label present"],
      ["Automated", analytics.summary.automatedCount, "Likely no-reply or system emails"],
      ["Busiest day", analytics.summary.busiestWeekday, "Most active weekday in sample"],
    ];
  }, [analytics.summary]);

  function handleConnect() {
    window.location.href = `${API_BASE_URL}/auth/google/start`;
  }

  async function handleLoadAnalytics() {
    setLoading(true);
    setStatus({
      message: "Fetching 50 Gmail messages and computing analytics...",
      isError: false,
    });

    try {
      const payload = await apiFetch("/api/analytics");
      setAnalytics(payload.analytics);
      setSession({
        authenticated: true,
        email: payload.email || session.email,
      });
      setStatus({
        message: `Loaded ${payload.maxResults} messages${payload.email ? ` for ${payload.email}` : ""}.`,
        isError: false,
      });
    } catch (error) {
      setStatus({
        message: error.message,
        isError: true,
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleDisconnect() {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
      setSession({ authenticated: false, email: "" });
      setAnalytics(EMPTY_ANALYTICS);
      setStatus({
        message: "Disconnected from Gmail.",
        isError: false,
      });
    } catch (error) {
      setStatus({
        message: error.message,
        isError: true,
      });
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-card">
        <div className="hero-copy">
          <p className="eyebrow">Gmail Analytics</p>
          <h1>See what your last 50 emails say about your inbox.</h1>
          <p className="subtitle">
            A compact inbox dashboard powered by Gmail metadata, with auth and
            analytics handled cleanly on the backend.
          </p>

          <div className="auth-strip">
            <div
              className={`auth-badge ${
                session.authenticated ? "auth-badge--online" : "auth-badge--offline"
              }`}
            >
              {session.authenticated
                ? `Connected${session.email ? ` as ${session.email}` : ""}`
                : "Not connected"}
            </div>
            <p className="auth-caption">
              {session.authenticated
                ? "Your backend session is active. You can refresh analytics or disconnect anytime."
                : "Connect Gmail to load your latest 50-message analytics snapshot."}
            </p>
          </div>
        </div>

        <div className="hero-actions">
          <button
            type="button"
            className="button button-primary"
            disabled={session.authenticated}
            onClick={handleConnect}
          >
            {session.authenticated ? "Gmail Connected" : "Connect Gmail"}
          </button>
          <button
            type="button"
            className="button button-accent"
            disabled={!session.authenticated || loading}
            onClick={handleLoadAnalytics}
          >
            {loading ? "Loading..." : "Load Analytics"}
          </button>
          <button
            type="button"
            className="button button-ghost"
            disabled={!session.authenticated}
            onClick={handleDisconnect}
          >
            Disconnect
          </button>
        </div>
      </section>

      <section className={`status-banner ${status.isError ? "status-banner--error" : ""}`}>
        {status.message}
      </section>

      <section className="metrics-grid">
        {metrics.length === 0 ? (
          <article className="panel empty-panel">
            <h2>Dashboard ready</h2>
          </article>
        ) : (
          metrics.map(([label, value, note]) => (
            <MetricCard key={label} label={label} value={value} note={note} />
          ))
        )}
      </section>

      <section className="content-grid">
        <ListPanel
          title="Top Senders"
          subtitle="Most frequent sources in the sample"
          items={analytics.topSenders}
        />
        <ListPanel
          title="Label Mix"
          subtitle="How Gmail classified these messages"
          items={analytics.labelCounts}
        />
      </section>

      <WeekdayPanel rows={analytics.weekdayCounts} />
      <RecentMessagesTable rows={analytics.recentMessages} />
    </main>
  );
}
