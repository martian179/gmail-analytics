import crypto from "crypto";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3001);
const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:3000";
const maxResults = Number(process.env.MAX_RESULTS || 50);
const cookieSecure = process.env.COOKIE_SECURE === "true";
const cookieSameSite = process.env.COOKIE_SAME_SITE || "lax";

const sessions = new Map();
const oauthStates = new Map();

app.use(
  cors({
    origin: frontendOrigin,
    credentials: true,
  }),
);
app.use(express.json());

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  return raw.split(";").reduce((acc, chunk) => {
    const [name, ...rest] = chunk.trim().split("=");
    if (!name) return acc;
    acc[name] = decodeURIComponent(rest.join("="));
    return acc;
  }, {});
}

function appendCookie(res, name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.maxAge) parts.push(`Max-Age=${options.maxAge}`);
  res.append("Set-Cookie", parts.join("; "));
}

function clearCookie(res, name) {
  const parts = [`${name}=`, "Path=/", "Max-Age=0", `SameSite=${cookieSameSite}`];
  if (cookieSecure) parts.push("Secure");
  parts.push("HttpOnly");
  res.append("Set-Cookie", parts.join("; "));
}

function getSession(req) {
  const cookies = parseCookies(req);
  const sessionId = cookies.gmail_session;

  if (!sessionId || !sessions.has(sessionId)) {
    return null;
  }

  const session = sessions.get(sessionId);

  if (session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return null;
  }

  return { sessionId, ...session };
}

function getHeader(headers, name) {
  return (
    headers.find((header) => header.name.toLowerCase() === name.toLowerCase())
      ?.value || ""
  );
}

function parseEmail(raw = "") {
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim().toLowerCase();
}

function normalizeMessage(message) {
  const headers = message.payload?.headers || [];
  const labelIds = message.labelIds || [];

  return {
    id: message.id,
    date: new Date(Number(message.internalDate)).toISOString(),
    from: parseEmail(getHeader(headers, "From")),
    subject: getHeader(headers, "Subject") || "(No Subject)",
    labels: labelIds,
    sent: labelIds.includes("SENT"),
    unread: labelIds.includes("UNREAD"),
    starred: labelIds.includes("STARRED"),
    important: labelIds.includes("IMPORTANT"),
    hasAttachment: Boolean(
      message.payload?.parts?.some((part) => part.filename),
    ),
    automated: /no-?reply|newsletter|notification|updates?/i.test(
      getHeader(headers, "From"),
    ),
  };
}

function countBy(items, selector) {
  const counts = new Map();

  for (const item of items) {
    const key = selector(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

function buildAnalytics(messages) {
  const weekdays = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];

  const weekdayCounts = weekdays.map((label, index) => ({
    label,
    value: messages.filter((message) => new Date(message.date).getDay() === index)
      .length,
  }));

  const busiestWeekday =
    [...weekdayCounts].sort((a, b) => b.value - a.value)[0]?.label || "-";

  return {
    summary: {
      fetchedCount: messages.length,
      receivedCount: messages.filter((message) => !message.sent).length,
      sentCount: messages.filter((message) => message.sent).length,
      unreadCount: messages.filter((message) => message.unread).length,
      uniqueSendersCount: new Set(
        messages.map((message) => message.from).filter(Boolean),
      ).size,
      attachmentCount: messages.filter((message) => message.hasAttachment).length,
      starredCount: messages.filter((message) => message.starred).length,
      importantCount: messages.filter((message) => message.important).length,
      automatedCount: messages.filter((message) => message.automated).length,
      busiestWeekday,
    },
    topSenders: countBy(messages, (message) => message.from).slice(0, 5),
    labelCounts: countBy(
      messages.flatMap((message) => message.labels),
      (label) => label,
    ).slice(0, 8),
    weekdayCounts,
    recentMessages: [...messages]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 12),
  };
}

async function googleTokenExchange(code) {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    grant_type: "authorization_code",
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

async function gmailRequest(accessToken, path) {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Gmail API error: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

async function fetchMessagesInBatches(accessToken, refs, batchSize = 5) {
  const messages = [];

  for (let index = 0; index < refs.length; index += batchSize) {
    const batch = refs.slice(index, index + batchSize);
    const batchResults = await Promise.all(
      batch.map((message) =>
        gmailRequest(
          accessToken,
          `users/me/messages/${message.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
        ),
      ),
    );
    messages.push(...batchResults);
  }

  return messages;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/auth/session", (req, res) => {
  const session = getSession(req);
  res.json({
    authenticated: Boolean(session),
    email: session?.email || "",
  });
});

app.get("/auth/google/start", (_req, res) => {
  const state = crypto.randomUUID();
  oauthStates.set(state, Date.now());

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", process.env.GOOGLE_REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set(
    "scope",
    "https://www.googleapis.com/auth/gmail.readonly",
  );
  authUrl.searchParams.set("access_type", "online");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);

  res.redirect(authUrl.toString());
});

app.get("/auth/google/callback", async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code || !state || !oauthStates.has(state)) {
      return res.status(400).send("Invalid OAuth callback.");
    }

    oauthStates.delete(state);

    const tokens = await googleTokenExchange(String(code));
    const profile = await gmailRequest(tokens.access_token, "users/me/profile");
    const sessionId = crypto.randomUUID();

    sessions.set(sessionId, {
      accessToken: tokens.access_token,
      email: profile.emailAddress || "",
      expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
    });

    appendCookie(res, "gmail_session", sessionId, {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: cookieSameSite,
      path: "/",
      maxAge: Number(tokens.expires_in || 3600),
    });

    res.redirect(frontendOrigin);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

app.post("/auth/logout", (req, res) => {
  const session = getSession(req);

  if (session?.sessionId) {
    sessions.delete(session.sessionId);
  }

  clearCookie(res, "gmail_session");
  res.json({ ok: true });
});

app.get("/api/analytics", async (req, res) => {
  try {
    const session = getSession(req);

    if (!session?.accessToken) {
      return res.status(401).json({ error: "Not authenticated." });
    }

    const listData = await gmailRequest(
      session.accessToken,
      `users/me/messages?maxResults=${maxResults}`,
    );

    const refs = listData.messages || [];
    const rawMessages = await fetchMessagesInBatches(session.accessToken, refs);

    res.json({
      fetchedAt: new Date().toISOString(),
      email: session.email || "",
      maxResults,
      analytics: buildAnalytics(rawMessages.map(normalizeMessage)),
    });
  } catch (error) {
    if (/401/.test(error.message)) {
      return res.status(401).json({ error: "Session expired. Connect Gmail again." });
    }

    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
