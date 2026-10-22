# Deploy DoorsOpen to Vercel

The website is built as static files, and the server (the event log API) runs as one Vercel function.
Everything is already set up in `vercel.json`, `api/index.mjs` and `package.json`.

## 1. Check it works on your laptop first

    pnpm install        (also fetches the sound library and updates pnpm-lock.yaml)
    pnpm test
    pnpm dev            (open http://localhost:3000 and http://localhost:3000/acoustic)

## 2. Put it on GitHub

Create an empty repository on github.com (no README), then in the project folder:

    git init
    git add .
    git commit -m "DoorsOpen with sound check-in"
    git branch -M main
    git remote add origin https://github.com/YOUR-NAME/YOUR-REPO.git
    git push -u origin main

`.env` is ignored by git, so your database password is not uploaded.

## 3. Import it in Vercel

1. vercel.com, then Add New, then Project, then pick your repository.
2. Leave every build setting alone. `vercel.json` already sets them.
3. Open Environment Variables and add:
   - Name: `DATABASE_URL`
   - Value: your Neon connection string (it ends with `?sslmode=require`). If Neon offers a "pooled" string, use that one.
4. Press Deploy.

## 4. Check it

- `https://YOUR-APP.vercel.app/api/health` should show `{"status":"ok","database":"configured"}`
- `https://YOUR-APP.vercel.app/acoustic` is the sound check-in. It is https, so the microphone works.
- The pill at the top of that page says "Live from the event log" when the database is connected.

The first request after a quiet period can take a few seconds while the function wakes up and checks the tables.

## If something goes wrong

- Build fails with a lockfile message: run `pnpm install` locally, commit `pnpm-lock.yaml`, push.
- `/api/health` is a 404: open the deployment's Build Logs, check that `pnpm build:vercel` finished, and send me the log.
- The pill says "Sample plan": `DATABASE_URL` is missing or wrong in Vercel. Fix it, then redeploy.
- Changed server code? `pnpm build:api` rebuilds `api/index.mjs` (Vercel also does this on every deploy).

I could not run a real Vercel deployment from my side, so if the first deploy shows an error, send me the build log and I will fix it.
