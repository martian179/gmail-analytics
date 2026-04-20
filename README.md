# Gmail Analytics

A proper split project:

- `front/` is a React app built with Vite
- `backend/` is an Express API that owns Google OAuth, Gmail access, sessions, and analytics

## Analytics included

The dashboard loads a 50-email sample and shows:

1. fetched emails
2. received emails
3. sent emails
4. unread emails
5. unique senders
6. emails with attachments
7. starred emails
8. important emails
9. automated emails
10. busiest weekday

It also renders:

- top senders
- label mix
- weekday distribution
- recent messages table

## Frontend setup

1. Copy `front/.env.example` to `front/.env`
2. Set:

```env
VITE_API_BASE_URL=http://localhost:3001
```

## Backend setup

1. Copy `backend/.env.example` to `backend/.env`
2. Fill in:

```env
PORT=3001
FRONTEND_ORIGIN=http://localhost:3000
BACKEND_URL=http://localhost:3001
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3001/auth/google/callback
MAX_RESULTS=50
COOKIE_SECURE=false
COOKIE_SAME_SITE=lax
```

## Local run

Frontend:

```bash
cd front
npm install
npm run dev
```

Backend:

```bash
cd backend
npm install
npm start
```

## Google OAuth setup

Create a Google OAuth client of type `Web application`.

Use:

- Authorized JavaScript origin:
  - `http://localhost:3000`
- Authorized redirect URI:
  - `http://localhost:3001/auth/google/callback`

Add your Gmail account as a test user on the Google OAuth audience page.

## Deploy

- Deploy `front/` as a Vite static site on Netlify or Cloudflare Pages
- Deploy `backend/` on Render
- Set `VITE_API_BASE_URL` in the frontend deployment
- Set backend environment variables in Render
- For cross-site cookies in production, set:
  - `COOKIE_SECURE=true`
  - `COOKIE_SAME_SITE=none`
