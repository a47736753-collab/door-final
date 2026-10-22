# Sound check-in

Open `/acoustic` (or the "Sound check-in" link in the sidebar).

- **Send my status:** a volunteer picks their name, a session and Ready or Not ready, then plays the sound.
- **Listen for statuses:** the organiser's laptop listens, decodes, checks the seal and lists each message.
- **No second device?** Press "Run a demo" on the Listen side. It sends made-up volunteers through the real checks, with no sound and nothing saved.
- **Shortcuts on the Send side:** R = ready, N = not ready, P = play.
- **Hover or tap a colour** in the byte strip to see what that part of the message means.

The microphone only works on `localhost` or `https` (Vercel is https).

Keys are DEMO keys (`client/src/features/acoustic/keyring.ts`). Replace them with private keys before a real event.

"Save results to the event log" is off by default. When on, it writes the existing ConfirmationAccepted,
StaleConfirmationFlagged and ConfirmationRejected events.

Tests: `pnpm test`. The real sound round-trip test runs once the `ggwave` package is installed (`pnpm install` does that).
