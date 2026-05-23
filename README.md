# NIRANTAR — Physiotherapy Home Services

A premium physiotherapy home-visit booking website for Thane, Mumbai.

## Tech Stack
- Pure HTML / CSS / JavaScript (no framework)
- Supabase — Auth + PostgreSQL database
- Netlify — Static hosting

## Features
- Home visit appointment booking
- Patient dashboard with recovery tracking
- Pain journal & wellness log
- BMI calculator
- Knowledge hub
- Admin portal (separate deployment)

## Setup
1. Created a Supabase project
2. Run `supabase/schema_complete.sql` in the SQL Editor
3. Copy your Supabase URL and anon key into `js/config.js`
4. Deploy to Netlify by dragging this folder

## Security Note
`admin/js/config.js` contains the service role key and is excluded from this repo via `.gitignore`.
Never commit it to a public repository.
