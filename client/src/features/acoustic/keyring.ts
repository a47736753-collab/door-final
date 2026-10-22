import { sha256 } from "./sha256";

/**
 * DEMO KEYS ONLY.
 *
 * Each volunteer needs a secret key that only their device and the organiser's laptop know.
 * Here the key is derived from the volunteer's ID so the feature works out of the box.
 * Anyone who reads this file can work out every key, so the seal proves nothing against a
 * determined person. Before a real event, replace this function with keys you hand out
 * privately (for example one random 32-byte key per volunteer).
 */
export function demoKeyFor(volunteerId: string): Uint8Array {
  return sha256(new TextEncoder().encode(`doorsopen-demo-key/v1/${volunteerId}`));
}
