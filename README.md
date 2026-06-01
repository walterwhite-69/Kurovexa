<div align="center">

<img src="https://raw.githubusercontent.com/walterwhite-69/Anivexa/main/favicon.svg" width="64" height="64" alt="Anivexa Logo" />

# Anivexa

**A clean, fast, and privacy-focused anime streaming site.**  
Built with vanilla HTML/CSS/JS and a Python Flask backend.

[![Deploy](https://img.shields.io/badge/Deploy-Vercel-black?style=flat-square&logo=vercel)](https://vercel.com)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![License](https://img.shields.io/badge/License-MIT-purple?style=flat-square)](#license)

<a href="https://discord.gg/zs22ZJttZM">
    <img src="https://img.shields.io/badge/Discord-Join%20Community-5865F2?style=for-the-badge&logo=discord&logoColor=white"/>
  </a>
</div>

---

## What is this?

Anivexa is a self-hosted anime streaming platform. No ads, no clutter. Just anime.

It proxies episode data through your own backend so nothing leaks your API source. All API traffic is encrypted end-to-end using AES-256-GCM — requests and responses are both encrypted blobs, un[...]

---

> Note: Due to constant updates, Anivexa has been made closed-source and wont be maintained properly on template version. It will get updated once in a few months. The hosted version will be maintained Properly

## Features

- **Spotlight & Trending** — dynamically loaded hero section and trending/popular grids
- **Episode Player** — multi-source player with sub/dub toggle
- **Browse & Search** — filter by genre, format, season, year
- **Airing Schedule** — weekly anime schedule with countdown
- **User Accounts** — register, login, JWT sessions, profile customization
- **AniList Sync** — link your AniList account, track watch progress, sync lists
- **Profile Customization** — Crunchyroll avatar and banner selection
- **End-to-End Encryption** — all API calls go through `/api/secure/pipe` as encrypted payloads
- **Changelog Modal** — shows users what's new on each update

---

## Sources

Episodes are sourced through the connected anime API. Anivexa is built to work with the **[Miruro API](https://github.com/walterwhite-69/Miruro-API)** — a self-hostable anime data + streaming A[...]

Supported providers (via the API):

| Provider | Type |
|---|---|
| AnimePahe | Sub |
| Zoro / AniWave | Sub + Dub |
| Anime Kai | Sub + Dub |
| Gogoanime | Sub + Dub |

> Source availability depends on the anime API you configure. See [Setup](#setup).

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | HTML, CSS, JavaScript |
| Backend | Python, Flask |
| Database | Turso (SQLite edge DB) |
| Auth | JWT + bcrypt |
| Anime Data | Your configured anime API |
| AniList | OAuth 2.0 + GraphQL |
| Encryption | AES-256-GCM (Web Crypto API) |
| Hosting | Vercel |

---

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/walterwhite-69/Anivexa.git
cd Anivexa
```

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

### 3. Configure environment

Copy `.env.example` to `.env` and fill in your values:

```env
TURSO_URL=YOUR_TURSO_DATABASE_URL
TURSO_TOKEN=YOUR_TURSO_AUTH_TOKEN
JWT_SECRET=YOUR_STRONG_JWT_SECRET_HERE
ANILIST_CLIENT_ID=YOUR_ANILIST_CLIENT_ID
ANILIST_CLIENT_SECRET=YOUR_ANILIST_CLIENT_SECRET
ANILIST_REDIRECT_URI=http://localhost:5500/api/auth/anilist/callback
RECAPTCHA_SECRET=YOUR_RECAPTCHA_V3_SECRET
ANIME_API_URL=YOUR_DEPLOYED_ANIME_API_URL
```

**Where to get these:**
- **Turso** — [turso.tech](https://turso.tech) — free SQLite edge DB, get URL + token from dashboard
- **AniList OAuth** — [anilist.co/settings/developer](https://anilist.co/settings/developer) — create an API client
- **reCAPTCHA v3** — [google.com/recaptcha](https://www.google.com/recaptcha) — v3 site + secret keys
- **Anime API** — deploy your own instance of **[Miruro API](https://github.com/walterwhite-69/Miruro-API)** and use its URL here

### 4. Run locally

```bash
python server.py
```

Open [http://localhost:5500](http://localhost:5500)

### 5. Deploy to Vercel

```bash
vercel --prod
```

Add all your `.env` variables to Vercel → Project Settings → Environment Variables.

---

## Encryption

All anime API calls are encrypted in transit. Here's how it works:

1. The server generates a session key from your `JWT_SECRET` and injects it as a hidden `<meta>` tag in the HTML
2. The browser reads the key from the DOM (no network request)
3. Every API call is encrypted with AES-256-GCM and sent to `/api/secure/pipe?e=...`
4. The server decrypts, proxies the real request, compresses + re-encrypts the response
5. The browser decrypts and renders the data

Nobody looking at the network tab sees raw API endpoints or responses.

---

## Project Structure

```
Anivexa/
├── server.py                          # Flask backend
├── vercel.json                        # Vercel deployment config
├── requirements.txt
├── .env.example
├── index.html                         # Home page
├── anime.html                         # Anime details + player
├── browse.html                        # Browse & search
├── schedule.html                      # Airing schedule
├── profile.html                       # User profile
├── js/
│   ├── api.js                         # API layer + AES-GCM crypto
│   ├── home.js
│   ├── anime.js
│   ├── browse.js
│   └── profile.js
├── css/
│   ├── style.css
│   └── profile.css
└── assets/
```

---

## AniList Integration

Connect your AniList account from the profile page. Once linked:

- Your watching/completed/planned lists sync with Anivexa
- Episode progress is tracked and saved back to AniList automatically
- Stats (total episodes watched, mean score, etc.) show on your profile

---

## License

MIT — do whatever you want with it. Credit appreciated but not required.

---

<div align="center">

Made with too much free time and too many anime hours.

</div>
