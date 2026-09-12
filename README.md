GREENSHORT (GS)

A modern URL shortener built with Cloudflare Pages, D1 Database and Analytics Engine.

FEATURES

URL shortening with custom or auto-generated slugs
AI-powered slug generation using Workers AI
Link Hubs to group multiple links
Password protection for links and hubs
Link expiration with "Never expires" option
Analytics with Analytics Engine (does not fill D1)
Real-time click flow (country, referrer, user-agent)
Modern interface with dark mode and gradients
Multi-language support (Spanish, English, Russian, Simplified Chinese, Traditional Chinese)
Responsive for mobile and desktop
Multi-select for batch delete
Automatic bot detection

QUICK START (FORK)

1. Fork this repository:
   https://github.com/quasvx/GreenShort/fork

2. Create the D1 database:
   npx wrangler d1 create greenshort-db
   Note the database_id that is returned.

3. Create the Analytics Engine dataset:
   In Cloudflare Dashboard -> Workers & Pages -> Analytics Engine -> Create dataset:
   Name: greenshort

4. Configure environment variables:
   In Cloudflare Pages -> Settings -> Environment Variables:

   SITE_TOKEN           = your_secret_token       (Dashboard access token)
   CF_ACCOUNT_ID        = your_account_id         (Cloudflare Account ID)
   CF_D1_ID             = your_d1_id              (D1 database ID)
   CF_API_TOKEN         = your_api_token          (Cloudflare API token)
   MAX_SLUG_LENGTH      = 20                      (Maximum slug length)
   MAX_EXPIRATION_DAYS  = 365                     (Maximum expiration days)
   AI_MODEL             = (your workers ai model, id recommend @cf/moonshot-ai/kimi-k2.5)  

5. Configure bindings:
   In Cloudflare Pages -> Settings -> Functions:

   D1 Database:
     Variable name: DB
     D1 Database: greenshort-db

   Analytics Engine:
     Variable name: ANALYTICS
     Dataset: greenshort

   Workers AI:
     Variable name: AI

6. Deploy:
   npx wrangler pages deploy .
   Or connect your forked repository to Cloudflare Pages for automatic deployment.

PROJECT STRUCTURE

GreenShort/
├── functions/
│   ├── [[path]].js          # Main router (API + link resolution)
│   └── lib.js               # Shared utilities (DB, auth, analytics)
├── gs/
│   ├── dashboard.html       # Admin panel
│   ├── password.html        # Password gate
│   └── hub.html             # Hub landing page
└── gs-files/
    └── locales/             # Translations
        ├── es_es.json
        ├── en_us.json
        ├── ru_ru.json
        ├── zh_cn.json
        └── zh_tw.json

GETTING THE CREDENTIALS

CF_ACCOUNT_ID
1. Go to Cloudflare Dashboard (dash.cloudflare.com)
2. Copy the Account ID from the right sidebar

CF_D1_ID
1. Go to Workers & Pages -> D1
2. Click on your database
3. Copy the Database ID

CF_API_TOKEN
1. Go to My Profile -> API Tokens -> Create Token
2. Create a token with these permissions:
   - Account -> D1 -> Edit
   - Account -> Account Analytics -> Read
3. Copy the token (it is only shown once)

USAGE

Access the panel
1. Open https://yourdomain.com/gs/dashboard
2. Enter your SITE_TOKEN

Create a link
1. Click on + Link
2. Fill in:
   - Slug: Custom (optional)
   - Destination URL: The URL to shorten
   - Password: (Optional)
   - Expiration: (Optional, supports "Never expires")
3. You can generate the slug in 3 ways:
   - Manual
   - Random (custom length, any value between 3 and MAX_SLUG_LENGTH)
   - Generate with AI (analyzes the URL and proposes an ASCII slug)

Create a hub
1. Click on + Hub
2. Configure title, bio, palette and links
3. It can have its own password

API ENDPOINTS

All require authentication with header Authorization: Bearer <SITE_TOKEN>.

GET  /api/config                    Configuration (limits)
GET  /api/storage                   D1 usage
GET  /api/links                     List links + clicks from Analytics Engine
GET  /api/hub-config?slug=xxx       Hub configuration
POST /api/ai-slug                   Generate slug with AI
POST /api/create                    Create/update link
POST /api/save-hub                  Save hub
POST /api/delete                    Delete (one or many)
GET  /api/analytics                 Latest 150 visits
GET  /api/flow                      Click flow with filters

DATABASE

Table links
slug TEXT PRIMARY KEY,
type TEXT DEFAULT 'direct',  -- 'direct' or 'group'
target_url TEXT,
splat INTEGER DEFAULT 1,
password TEXT,
expires_at INTEGER,
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP

Table hub_configs
slug TEXT PRIMARY KEY,
mode TEXT DEFAULT 'builder',
title TEXT,
bio TEXT,
theme_palette TEXT,
btn_style TEXT,
bg_type TEXT,
bg_val TEXT,
custom_html TEXT,
lang_mode TEXT DEFAULT 'auto',
items_json TEXT

Note: There is no analytics table because events are stored in Analytics Engine.

SLUG RULES

- Only lowercase letters (a-z), numbers (0-9) and underscores (_)
- Length controlled by MAX_SLUG_LENGTH env variable
- Reserved slugs: favicon.ico, favicon.svg, robots.txt, sitemap.xml, gs, gs-files

ADDING A LANGUAGE

1. Copy gs-files/locales/es_es.json to gs-files/locales/xx_xx.json
2. Translate the values
3. Add the option in the language selector of the dashboard and password

SECURITY

- HTTPS required
- Access token stored in localStorage
- Slug format validation ([a-z0-9_])
- Protected reserved routes
- Bot detection
- Rate limiting by Cloudflare

Recommendations:
- Rotate SITE_TOKEN periodically
- Use strong passwords for protected links
- Do not share CF_API_TOKEN

TROUBLESHOOTING

Error 500 on /api/analytics or /api/flow
- Verify that the ANALYTICS binding is configured
- Verify that CF_ACCOUNT_ID and CF_API_TOKEN are configured
- The token must have Account Analytics Read permission

Error 500 on /api/ai-slug
- Verify that the AI binding is configured
- Check that the AI_MODEL exists in Workers AI
- Recommended models: @cf/meta/llama-3.3-70b-instruct-fp8-fast, @cf/qwen/qwen3-30b-a3b-fp8

"No such model" in AI
- Switch to a valid model
- Models change over time, check Cloudflare Workers AI Models

Bad AI slug quality
- Use a larger model (avoid llama-3.2-1b-instruct)
- Recommended: @cf/meta/llama-3.3-70b-instruct-fp8-fast

Clicks do not appear
- Analytics Engine takes ~1 minute to process events
- Verify that the ANALYTICS binding has dataset greenshort

DEPENDENCIES

- Cloudflare Pages - Hosting
- D1 Database - SQLite for configuration
- Analytics Engine - Metrics
- Workers AI - Slug generation
- No external dependencies - All native to Cloudflare

LICENSE

MIT License

AUTHOR

quasvx - github.com/quasvx

If you like the project, give it a star on GitHub.
