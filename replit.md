# techy Minecraft website

## Overview
A multi-page Minecraft server portal with a Node/Express backend, PostgreSQL persistence, Clerk-ready sign-in/sign-up, dashboard, forums, applications, appeals, support tickets, store, gallery, changelog, leaderboard, bans, rules, announcements, and an owner/admin panel.

## Runtime
- `server.js` serves the static HTML pages and `/api/*` backend routes.
- Required secure settings are read from environment variables: `NEON_DATABASE_URL` or `DATABASE_URL`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `ADMIN_PASSWORD`.
- The app listens on port `5000` for Replit web preview.

## Admin
The admin panel supports owner password login through `/api/admin/login` and Clerk staff users when their rank is `moderator`, `admin`, or `owner`. Admins can create, edit, delete, review, ban/unban, and promote records from the dashboard.

## Database
PostgreSQL tables are auto-created on startup when `NEON_DATABASE_URL` or `DATABASE_URL` is configured. Seed content is inserted only when the main content tables are empty.
