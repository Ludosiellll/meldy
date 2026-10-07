# VAPID key rotations

Each change to this file on `claude/relaxed-hypatia-1tpmq5` runs `.github/workflows/rotate-vapid.yml`: a new Web Push
key pair is made on the GitHub runner and stored in the Space settings (`VAPID_PRIVATE_KEY` as a secret,
`VAPID_PUBLIC_KEY` as a variable). The private key is never printed, committed or sent anywhere else. The job restarts
the Space and waits until `/api/push/key` serves the new public key. Add one dated line per rotation.

- 2026-10-07 — first rotation: the old private key had been in the Git history (`backend/private_key.pem`, removed in
  September 2026). The owner does not handle keys; the agent runs this file.
