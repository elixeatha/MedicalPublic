// Schedules local, on-device alerts for "repeat review" patients.
//
// Limitation: browsers only allow reliable timers while this app/tab is open
// (or, on some platforms, briefly in the background). There is no server
// pushing these alerts, so if the browser/tab is fully closed the alert
// will not fire until the app is reopened -- at which point any alert whose
// time has already passed is shown immediately as a "missed review" catch-up
// notification.
const ReviewAlerts = (() => {
  const timers = new Map(); // patientId -> timeout handle

  function isSupported() {
    return 'Notification' in window;
  }

  function permission() {
    return isSupported() ? Notification.permission : 'unsupported';
  }

  async function requestPermission() {
    if (!isSupported()) return 'unsupported';
    if (Notification.permission === 'default') {
      return Notification.requestPermission();
    }
    return Notification.permission;
  }

  function fire(patient) {
    const title = `Review due: ${patient.name}`;
    const body = patient.reviewReason
      ? `Reason: ${patient.reviewReason}`
      : 'Scheduled repeat review time has been reached.';

    if (isSupported() && Notification.permission === 'granted') {
      try {
        const n = new Notification(title, { body, tag: `review-${patient.id}` });
        n.onclick = () => window.focus();
      } catch (e) {
        // Some mobile browsers require a Service Worker to show notifications.
        showViaServiceWorker(title, body, patient.id);
      }
    } else {
      showViaServiceWorker(title, body, patient.id);
    }

    document.dispatchEvent(new CustomEvent('review-due', { detail: { patientId: patient.id } }));
  }

  async function showViaServiceWorker(title, body, patientId) {
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.ready;
        if (reg && reg.showNotification && Notification.permission === 'granted') {
          reg.showNotification(title, { body, tag: `review-${patientId}` });
        }
      } catch (e) { /* no-op: fall back to in-app toast only */ }
    }
  }

  function cancel(patientId) {
    if (timers.has(patientId)) {
      clearTimeout(timers.get(patientId));
      timers.delete(patientId);
    }
  }

  function schedule(patient) {
    cancel(patient.id);
    if (!patient.reviewTime) return;
    const target = new Date(patient.reviewTime).getTime();
    const now = Date.now();
    const delay = target - now;

    if (delay <= 0) {
      // Missed while the app was closed -- alert immediately as a catch-up.
      fire(patient);
      return;
    }
    // setTimeout is reliable for delays well under its ~24.8 day cap;
    // our reviewTime is always within the next 24h.
    const handle = setTimeout(() => {
      fire(patient);
      timers.delete(patient.id);
    }, delay);
    timers.set(patient.id, handle);
  }

  function rescheduleAll(patients) {
    patients
      .filter((p) => p.status === 'repeat_review' && p.reviewTime)
      .forEach(schedule);
  }

  return { isSupported, permission, requestPermission, schedule, cancel, rescheduleAll };
})();
