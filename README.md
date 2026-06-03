# Flashcards

A free, no-account flashcard site for classmates. Decks live inside the share link itself — no server, no database, no cost.

- **SRS (spaced repetition)** — SM-2 lite scheduler, just like Anki
- **CSV / text import** — paste rows separated by tab, comma, or `|`
- **Make with AI** — built-in prompt template for ChatGPT / Claude / Gemini
- **Share via link** — deck is gzipped and base64-encoded into the URL
- **Mobile-friendly** — large tap targets, responsive layout, dark mode
- **Local-first** — your decks stay in your browser (localStorage)

## Run locally

Just open `index.html` in any modern browser. No build step.

```
open index.html
```

## Deploy to GitHub Pages

1. Create a new public repo on GitHub (e.g. `flashcards`).
2. From this folder:
   ```
   git init
   git add .
   git commit -m "first flashcards site"
   git branch -M main
   git remote add origin https://github.com/<your-user>/flashcards.git
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Source: Deploy from a branch → main / root**.
4. Wait ~1 min. Your site is live at `https://<your-user>.github.io/flashcards/`.

Share that URL with classmates. When anyone clicks **Share** on a deck, they get a link with the deck baked in — they can import or study it without an account.

## Keyboard shortcuts (study mode)

- `Space` / `Enter` — flip card
- `1` — Again, `2` — Hard, `3` — Good, `4` — Easy

## Notes & limits

- Share links use gzip + base64, so they're compact, but very large decks (thousands of cards) may produce URLs that some chat apps truncate. The share dialog shows the link length.
- SRS schedule is stored per browser. Importing a shared deck creates a fresh schedule for that browser.
- No tracking, no analytics, no cookies.
