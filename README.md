# FastTax

A quick estimate of 2026 federal and state income tax on wages, 1099 income, interest,
dividends and long-term capital gains, with a line-by-line breakdown, your current
brackets, and what more income would cost.

- **Private by design.** Everything runs in the browser. There is no server, database or
  analytics; the page's security policy blocks it from contacting any other site.
  Estimates are saved as files on your own device.
- **All 50 states and DC.** Rules live in `src/data/2026/`, one file per state, each with
  its sources and a list of figures not yet published for 2026.
- **An estimate, not tax advice.**

## Develop

```
npm install
npm run dev      # http://localhost:5180
npm test
npm run build    # static site in dist/
```

## Deploy

Static site; `vercel.json` sets the build and the security headers. Import the repository
in Vercel and it deploys on every push.
