# GreenShort

Self-hosted URL shortener that runs entirely on Cloudflare.
No servers, no external databases, no dependencies.
Everything lives inside your Cloudflare account using Pages, D1,
Workers AI, Analytics Engine, and optionally KV.


---

## What is GreenShort?

GreenShort is a URL shortener with an admin dashboard, designed
to be deployed in minutes and operated with zero maintenance.
It generates short links, builds link-in-bio style hubs, tracks
clicks with analytics, and offers password and captcha protection.
The frontend, backend, and database all run inside Cloudflare.

It is built for people who want their own shortener without relying
on third-party services, without paying subscriptions, and without
worrying about servers. You only need a Cloudflare account, a domain
(or the free Pages subdomain), and to follow the setup steps.


---

## Features

**Short links**
Create links with a custom or random slug.
Supports nested routes like `my_brand/promo/summer`.
Each link can point to its own destination URL.

**Link hubs (link-in-bio)**
Design link-in-bio style pages with multiple buttons, title, bio,
and color palette. Perfect for Instagram, TikTok, or any profile
where you want to group several destinations.

**AI-generated slugs**
Enter a URL and GreenShort analyzes the page content (title and
description) to suggest a short, descriptive, and unique slug.
Uses Workers AI, with no extra cost beyond your free quota.

**Built-in captcha**
Any link or hub can require a dynamically generated captcha.
It does not depend on Google reCAPTCHA or any external service.
It is a custom visual challenge, signed with HMAC and validated
with a secure cookie.

**Password protection**
You can protect any link or hub with a password.
Visitors must enter it before reaching the destination.

**Link expiration**
Configure how long a link stays active: minutes, hours, days, or
"never". Once expired, the link stops working automatically.

**Splat subroutes**
A link can capture everything that comes after the slug and pass
it to the destination. For example, `/promo/summer/discount` can
forward `/discount` to the target URL.

**Click analytics**
Every visit is recorded with country, user agent, referrer, IP,
and timestamp. View the data in the Analytics tab or the Click
Flow tab inside the dashboard.

**Storage usage indicator**
The header shows how much of your D1 database is used, in real
time, with a selectable unit (Auto, B, KB, MB, GB, TB, PB, EB,
ZB, YB).

**Multi-language dashboard**
The admin interface supports Spanish, English, Russian, Simplified
Chinese, and Traditional Chinese. Language is stored locally per
user.

**Dark theme**
The entire dashboard uses a dark, minimal design with green
accents, optimized for both desktop and mobile.


---

## How it works

GreenShort runs as a single Cloudflare Pages project with a
catch-all Worker that handles every request.

When someone visits a URL, the Worker checks if it matches a
stored slug. If it does, it applies the corresponding rules
(password, captcha, expiration, splat) and redirects to the
destination. If it does not match, it falls through to the
static files served by Pages.

All data is stored in a Cloudflare D1 database: one table for
links and one for hub configurations. Clicks are recorded in
Analytics Engine, which is queried via the Cloudflare API to
display statistics in the dashboard.

The admin dashboard authenticates using a single token
(`SITE_TOKEN`), stored in an environment variable.
All API requests require this token as a Bearer header.


---

## Requirements

Before deploying, make sure you have:

- A Cloudflare account (free plan is enough for most use cases).
- A Cloudflare Pages project.
- A D1 database bound to the Pages project.
- A Workers AI binding (free tier includes a generous daily quota).
- An Analytics Engine dataset (optional but recommended for
  click tracking).
- The following environment variables configured in Pages:
  - `SITE_TOKEN` - the admin password (minimum 8 characters).
  - `CF_ACCOUNT_ID` - your Cloudflare account ID.
  - `CF_D1_ID` - the D1 database ID.
  - `CF_API_TOKEN` - an API token with permissions to read D1
    and query Analytics Engine.
  - `MAX_SLUG_LENGTH` - optional, defaults to `20`.
  - `MAX_EXPIRATION_DAYS` - optional, defaults to `365`.
  - `AI_MODEL` - optional, the Workers AI model to use for
    slug generation.


---

## Recommended AI model

For the best balance between speed, quality, and cost, the
recommended model is:

    @cf/moonshot-ai/kimi-k2.5

This model produces clean, short, and contextually accurate slugs.
It is fast, reliable, and works well within the free Workers AI
quota for typical usage.

If you want to try alternatives, any instruct model available in
Workers AI will work, but results may vary in length and
formatting. The system already sanitizes and truncates output,
so any model will produce a usable slug, but Kimi K2.5 tends to
require fewer corrections.

To configure it, set the environment variable:

    AI_MODEL = @cf/moonshot-ai/kimi-k2.5

If you do not set this variable, GreenShort falls back to a
default model automatically.


---

## Reserved routes

The following routes are reserved by the system and cannot be
used as slugs:

- `favicon.ico`
- `favicon.svg`
- `robots.txt`
- `sitemap.xml`
- `gs`
- `gs-files`
- `api`

Any slug starting with an underscore (`_`) is also reserved,
following Cloudflare Pages conventions. The dashboard and API
both validate this, so you cannot create a slug that would
break the system.

The `gs` folder contains all the HTML files for the dashboard
and public pages. The `gs-files` folder contains static assets
like locales and images. Both are served directly by Pages and
never intercepted by the Worker's link resolution logic.


---

## Security

GreenShort is designed with security in mind:

- The admin dashboard uses a single token, stored only in
  localStorage after login.
- All API endpoints require the token as a Bearer header.
- Captchas are signed with HMAC using a per-link secret.
- Password-protected links compare passwords server-side.
- Captcha cookies are HttpOnly, Secure, and SameSite=Strict.
- Reserved routes are validated both on the frontend and the
  backend, so a user cannot create a link that would shadow
  internal routes.

The only thing you should never do is expose your `SITE_TOKEN`
publicly. Treat it like a password.


---

## Deployment summary

1. Fork or clone the repository.
2. Create a Cloudflare Pages project linked to the repository.
3. Create a D1 database and bind it to the Pages project as `DB`.
4. Create an Analytics Engine dataset named `greenshort` and
   bind it as `ANALYTICS`.
5. Add a Workers AI binding as `AI`.
6. Set the environment variables listed above.
7. Deploy. The first request will run the database migrations
   automatically.
8. Visit `/gs/dashboard` and log in with your `SITE_TOKEN`.

That is it. No build step, no external services, no maintenance.


---

## License

GreenShort is open source. Check the repository for the exact
license terms.

Source: github.com/quasvx/GreenShort
