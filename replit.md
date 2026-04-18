# VortexSMP Website

## Overview
A multi-page Minecraft server portal for VortexSMP (Vortexsmp.tech) with a Node/Express backend, PostgreSQL (Neon) persistence, Clerk sign-in/sign-up, dashboard, forums, applications, appeals, support tickets, store, gallery, changelog, leaderboard, bans, rules, announcements, and an owner/admin panel.

## Runtime
- `server.js` serves the static HTML pages and `/api/*` backend routes.
- Required secure settings: `NEON_DATABASE_URL`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `ADMIN_PASSWORD`.
- The app listens on port `5000` for Replit web preview.

## Vercel Deployment
- `vercel.json` uses rewrites to route `/api/*` to `api/index.js` (Express serverless function).
- Static HTML/CSS/JS files are served natively by Vercel from the project root.
- `jose` is pinned to v4.x (CJS-compatible) — do NOT upgrade to v5+ as it is ESM-only and will break Vercel.

## Admin
The admin panel supports owner password login through `/api/admin/login` and Clerk staff users when their rank is `moderator`, `admin`, or `owner`. Admins can create, edit, delete, review, ban/unban, and promote records. Delete actions require confirmation. Tabs: Overview, Users, Bans, Appeals, Applications, Tickets, Forums, Rules, Store, Gallery, Changelog, Announcements, Votes, Leaderboard.

## Database
PostgreSQL tables are auto-created on startup when `NEON_DATABASE_URL` or `DATABASE_URL` is configured. Seed content is inserted only when the main content tables are empty.

## Server IP
`Vortexsmp.tech`
