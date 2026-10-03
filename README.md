# Shop Stock

An offline-capable inventory app for small shopkeepers. It runs on a phone, works without internet, warns the shopkeeper before stock runs out or expires, and keeps a history of every sale.

**Live demo:** _add your Netlify link here_

## Why I built it

Many small shops in Kenya track stock in their heads or in notebooks. That makes it easy to miss that goods are running low, to sell old stock after it has expired, or to lose track of what was sold. Most shopkeepers use phones, not computers, and internet is not always available, so the app had to be phone-first and work offline.

## What it does

- **Items:** add products with a size (e.g. big or small unga) and a unit chosen by the shopkeeper (kg, packets, pieces).
- **Restock:** record new stock with an optional expiry date. Each restock becomes its own batch.
- **Sell:** record a sale. The app takes stock from the batch that expires first and moves to the next batch when one runs out, so old stock is sold before it goes bad.
- **Remaining stock:** the list shows the total for each item, with search.
- **Alerts:** a popup and an Alerts button show items running low, batches expiring within 2 days, and expired batches that have not been removed yet. Expired batches no longer count as stock until the shopkeeper marks them removed.
- **Offline use:** sales and restocks recorded without internet are kept on the phone and saved online automatically when the connection returns.
- **Installable:** it can be added to a phone's home screen and opens like a normal app.
- **Accounts:** each shopkeeper signs in and only ever sees their own stock.

## How it works

| Part | Choice | Reason |
| --- | --- | --- |
| Front end | Plain HTML, CSS and JavaScript | No build step, small, loads fast on phones |
| Database and login | Supabase (PostgreSQL) | Hosted database with built-in sign-in |
| Offline | Service worker plus a waiting list in the phone's storage | Updates are never lost when there is no signal |
| Hosting | Netlify | Free, and gives the app a link to open on any phone |

### Database

Four tables, each row owned by the shopkeeper who created it:

- `items`: name, size, unit, low-stock level
- `batches`: one row per restock, with quantity, expiry date, date added and status (active, expired or removed)
- `sales`: one row per sale
- `sale_details`: which batches each sale took stock from, since one sale can span several batches

### Design decisions

- **Earliest-expiry-first selling.** Batches are sorted by expiry date, and batches with no expiry date come last.
- **The shopkeeper stays in control.** If a sale is bigger than the recorded stock, the app warns but does not block it.
- **Sales are recorded, not just subtracted.** The sales history lets the shopkeeper see what happened later.
- **Security is enforced in the database.** Row Level Security rules make sure a signed-in user can only read and change rows they own. The public key in `config.js` is designed to be visible; the database rules are what protect the data.
- **Offline-first saving.** Every sale and restock goes into a waiting list first and is then synced, so the same code path handles online and offline use.

## Project files

```
index.html            page structure and dialogs
style.css             phone-first styling
app.js                all app logic (stock, sales, alerts, offline, login)
config.js             Supabase project URL and public key
supabase.js           local copy of the Supabase library (so it works offline)
sw.js                 service worker for offline use
manifest.webmanifest  makes the app installable
icon-192.png, icon-512.png
```

## Running it yourself

1. Create a free project at [supabase.com](https://supabase.com).
2. Create the four tables above, add an `owner_id uuid default auth.uid()` column to each, turn on Row Level Security, and add an "owner only" policy to each table (`owner_id = auth.uid()`).
3. In Supabase, go to Authentication, then Sign In / Providers, then Email, and decide whether to require email confirmation.
4. Put your project URL and publishable key in `config.js`.
5. Serve the folder from any static host (Netlify, GitHub Pages) or open `index.html` locally. Offline mode and installing need a web address, not a local file.

Never put a Supabase **secret** key in this project.

## Status and next steps

Version 1 is complete and working. Planned for later:

- Price saved at the time of each sale, and a daily money total
- Password reset and a way to correct a sale entered by mistake
- Desktop layout with more advanced features
- Testing with real shopkeepers and acting on what they find confusing

## Author

Built by Dennis, a Bachelor of IT student at Murang'a University of Technology, Kenya.
