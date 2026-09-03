# MedicalPublic

Patient Tracker — a small offline-first web app (installable as a PWA) for
keeping a working list of patients on a phone or tablet.

## Features

- **New Patient** tab: enter Name, MRN, NHS number, Date of Birth and
  Details, and attach images either by taking a photo with the device
  camera or adding existing files. Tap **Add new patient** to save.
- **Patients** tab: card list of everyone added, showing a summary and a
  thumbnail. Tap a card to open the full record and view all attached
  images. Each card has an actions dropdown on the right:
  - **Remove** — deletes the patient permanently.
  - **To discuss** — moves the patient to the **To Discuss** tab.
  - **Needs repeat review** — opens a dialog to pick a 24-hour time and a
    reason, then moves the patient to the **Repeat Review** tab.
- **To Discuss** tab: patients flagged for discussion.
- **Repeat Review** tab: patients awaiting a scheduled review, tagged with
  the time it's due (and highlighted once overdue). When the device's
  local clock reaches that time, the app fires a browser/OS notification
  with the reason.

All data (including images) is stored locally in the browser via
IndexedDB — nothing is sent to a server.

## Running it

No build step is required. Serve the folder with any static file server
and open it in a browser, e.g.:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

For alerts and the camera to work well on a phone, open it over HTTPS (or
`localhost`) and add it to your home screen (Share → Add to Home Screen /
Install app) so it runs as a standalone PWA.

## Notification limitation

Repeat-review alerts are scheduled entirely client-side (there is no
backend push server). This means:

- Alerts fire reliably while the app/tab is open, including in the
  background on most desktop browsers.
- If the browser is fully closed before the scheduled time, the alert
  will not arrive in real time. When you reopen the app, any review
  whose time has already passed fires immediately as a catch-up alert,
  and is visually marked "Review due" in the Repeat Review tab.
- The first time you schedule a review, tap **Enable alerts** in the
  header to grant notification permission.
