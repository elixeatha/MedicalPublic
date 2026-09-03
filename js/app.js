(() => {
  'use strict';

  let patients = [];
  let pendingImages = []; // { id, dataUrl, name } for the New Patient form
  let activeDropdownPatientId = null; // patient currently targeted by the review modal

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  // ---------- Toast ----------
  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }

  // ---------- Tabs ----------
  function initTabs() {
    $$('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
  }

  function switchTab(tabId) {
    $$('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tabId));
    $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === tabId));
  }

  // ---------- Image handling (New Patient form) ----------
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const dataUrl = await fileToDataUrl(file);
        pendingImages.push({ id: uid(), dataUrl, name: file.name });
      } catch (e) {
        console.error('Failed to read image', e);
      }
    }
    renderImagePreview();
  }

  function renderImagePreview() {
    const grid = $('#imagePreview');
    grid.innerHTML = '';
    pendingImages.forEach((img) => {
      const thumb = document.createElement('div');
      thumb.className = 'thumb';
      thumb.innerHTML = `<img src="${img.dataUrl}" alt="${escapeHtml(img.name)}" />
        <button type="button" class="remove-thumb" data-id="${img.id}" aria-label="Remove image">&times;</button>`;
      grid.appendChild(thumb);
    });
    $$('.remove-thumb', grid).forEach((btn) => {
      btn.addEventListener('click', () => {
        pendingImages = pendingImages.filter((i) => i.id !== btn.dataset.id);
        renderImagePreview();
      });
    });
  }

  function resetForm() {
    $('#patientForm').reset();
    pendingImages = [];
    renderImagePreview();
  }

  // ---------- Add patient ----------
  async function handleAddPatient(e) {
    e.preventDefault();
    const name = $('#pName').value.trim();
    if (!name) {
      toast('Name is required');
      return;
    }
    const patient = {
      id: uid(),
      name,
      mrn: $('#pMRN').value.trim(),
      nhs: $('#pNHS').value.trim(),
      dob: $('#pDOB').value,
      details: $('#pDetails').value.trim(),
      images: pendingImages.map(({ id, dataUrl, name }) => ({ id, dataUrl, name })),
      status: 'active',
      reviewTime: null,
      reviewReason: null,
      createdAt: new Date().toISOString(),
    };
    await PatientDB.put(patient);
    patients.push(patient);
    resetForm();
    renderAll();
    toast('Patient added');
    switchTab('patients');
  }

  // ---------- Rendering lists ----------
  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function summaryText(p) {
    return p.details ? p.details : 'No details entered.';
  }

  function formatDob(dob) {
    if (!dob) return '—';
    const d = new Date(dob + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return dob;
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function reviewTagHtml(p) {
    if (p.status === 'discuss') {
      return `<span class="review-tag discuss">To discuss</span>`;
    }
    if (p.status === 'repeat_review' && p.reviewTime) {
      const due = new Date(p.reviewTime).getTime() <= Date.now();
      const t = new Date(p.reviewTime);
      const timeStr = t.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      return `<span class="review-tag ${due ? 'due' : 'upcoming'}">${due ? 'Review due' : 'Review at ' + timeStr}</span>`;
    }
    return '';
  }

  function cardHtml(p) {
    const firstImg = p.images && p.images[0];
    const thumb = firstImg
      ? `<img src="${firstImg.dataUrl}" alt="" />`
      : `<span class="no-img">👤</span>`;

    return `
      <div class="patient-card" data-id="${p.id}">
        <div class="thumb-wrap" data-action="view">${thumb}</div>
        <div class="main" data-action="view">
          <h3>${escapeHtml(p.name)}</h3>
          <p class="meta">MRN: ${escapeHtml(p.mrn) || '—'} &nbsp;•&nbsp; NHS: ${escapeHtml(p.nhs) || '—'} &nbsp;•&nbsp; DOB: ${formatDob(p.dob)}</p>
          <p class="summary">${escapeHtml(summaryText(p))}</p>
          ${reviewTagHtml(p)}
        </div>
        <select class="actions-select" data-action="menu" data-id="${p.id}">
          <option value="">Actions ▾</option>
          <option value="view">View</option>
          <option value="active" ${p.status === 'active' ? 'disabled' : ''}>Move to Patients</option>
          <option value="discuss" ${p.status === 'discuss' ? 'disabled' : ''}>To discuss</option>
          <option value="repeat_review">Needs repeat review</option>
          <option value="remove">Remove</option>
        </select>
      </div>`;
  }

  function renderList(containerSel, emptySel, list) {
    const container = $(containerSel);
    const empty = $(emptySel);
    if (!list.length) {
      container.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';
    container.innerHTML = list.map(cardHtml).join('');

    $$('.patient-card', container).forEach((card) => {
      const id = card.dataset.id;
      $$('[data-action="view"]', card).forEach((el) => {
        el.addEventListener('click', () => openDetail(id));
      });
      const select = $('[data-action="menu"]', card);
      select.addEventListener('change', () => {
        const val = select.value;
        select.value = '';
        if (!val) return;
        if (val === 'view') openDetail(id);
        else if (val === 'remove') removePatient(id);
        else if (val === 'repeat_review') openReviewModal(id);
        else handleStatusChange(id, val);
      });
    });
  }

  function renderAll() {
    const active = patients.filter((p) => p.status === 'active')
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const discuss = patients.filter((p) => p.status === 'discuss');
    const review = patients.filter((p) => p.status === 'repeat_review')
      .sort((a, b) => new Date(a.reviewTime) - new Date(b.reviewTime));

    renderList('#patientsList', '#patientsEmpty', active);
    renderList('#discussList', '#discussEmpty', discuss);
    renderList('#reviewList', '#reviewEmpty', review);

    $('#count-patients').textContent = active.length || '';
    $('#count-discuss').textContent = discuss.length || '';
    $('#count-review').textContent = review.length || '';
  }

  // ---------- Status changes ----------
  async function handleStatusChange(id, status) {
    const p = patients.find((x) => x.id === id);
    if (!p) return;
    p.status = status;
    if (status !== 'repeat_review') {
      p.reviewTime = null;
      p.reviewReason = null;
      ReviewAlerts.cancel(id);
    }
    await PatientDB.put(p);
    renderAll();
    toast(
      status === 'discuss' ? 'Moved to To Discuss'
      : status === 'active' ? 'Moved to Patients'
      : 'Updated'
    );
  }

  async function removePatient(id) {
    const p = patients.find((x) => x.id === id);
    if (!p) return;
    if (!confirm(`Remove ${p.name}? This cannot be undone.`)) return;
    ReviewAlerts.cancel(id);
    await PatientDB.remove(id);
    patients = patients.filter((x) => x.id !== id);
    renderAll();
    toast('Patient removed');
  }

  // ---------- Detail modal ----------
  function openDetail(id) {
    const p = patients.find((x) => x.id === id);
    if (!p) return;
    const imagesHtml = (p.images && p.images.length)
      ? `<div class="detail-images">${p.images.map((img) => `<img src="${img.dataUrl}" alt="${escapeHtml(img.name)}" data-full="${img.dataUrl}" />`).join('')}</div>`
      : `<p class="empty-msg" style="padding:1rem 0;">No images attached.</p>`;

    $('#detailBody').innerHTML = `
      <h2>${escapeHtml(p.name)}</h2>
      <div class="detail-row"><span>MRN</span><span>${escapeHtml(p.mrn) || '—'}</span></div>
      <div class="detail-row"><span>NHS Number</span><span>${escapeHtml(p.nhs) || '—'}</span></div>
      <div class="detail-row"><span>Date of Birth</span><span>${formatDob(p.dob)}</span></div>
      ${p.status === 'repeat_review' && p.reviewTime ? `<div class="detail-row"><span>Repeat review</span><span>${new Date(p.reviewTime).toLocaleString()}</span></div>` : ''}
      ${p.reviewReason ? `<div class="detail-row"><span>Reason</span><span>${escapeHtml(p.reviewReason)}</span></div>` : ''}
      <p style="margin-top:0.9rem; white-space:pre-wrap;">${escapeHtml(p.details) || 'No details entered.'}</p>
      ${imagesHtml}
    `;
    $$('.detail-images img', $('#detailBody')).forEach((img) => {
      img.addEventListener('click', () => openFullImage(img.dataset.full));
    });
    $('#detailModal').hidden = false;
  }

  function openFullImage(src) {
    const viewer = document.createElement('div');
    viewer.className = 'full-image-viewer';
    viewer.innerHTML = `<img src="${src}" alt="" />`;
    viewer.addEventListener('click', () => viewer.remove());
    document.body.appendChild(viewer);
  }

  // ---------- Repeat review modal ----------
  function openReviewModal(id) {
    activeDropdownPatientId = id;
    $('#reviewTime').value = '';
    $('#reviewReason').value = '';
    $('#reviewModal').hidden = false;
  }

  async function confirmReview() {
    const id = activeDropdownPatientId;
    const p = patients.find((x) => x.id === id);
    if (!p) return;
    const timeVal = $('#reviewTime').value; // "HH:MM"
    if (!timeVal) {
      toast('Please choose a time');
      return;
    }
    const reason = $('#reviewReason').value.trim();

    const [h, m] = timeVal.split(':').map(Number);
    const target = new Date();
    target.setHours(h, m, 0, 0);
    if (target.getTime() <= Date.now()) {
      target.setDate(target.getDate() + 1); // time already passed today -> tomorrow
    }

    p.status = 'repeat_review';
    p.reviewTime = target.toISOString();
    p.reviewReason = reason;
    await PatientDB.put(p);

    ReviewAlerts.schedule(p);
    if (ReviewAlerts.isSupported() && Notification.permission === 'default') {
      $('#notifPermBtn').hidden = false;
    }

    closeModals();
    renderAll();
    toast(`Review scheduled for ${target.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`);
  }

  // ---------- Modal close ----------
  function closeModals() {
    $('#detailModal').hidden = true;
    $('#reviewModal').hidden = true;
    activeDropdownPatientId = null;
  }

  function initModals() {
    $$('[data-close]').forEach((btn) => btn.addEventListener('click', closeModals));
    [$('#detailModal'), $('#reviewModal')].forEach((modal) => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModals();
      });
    });
    $('#confirmReviewBtn').addEventListener('click', confirmReview);
  }

  // ---------- Notifications ----------
  function initNotifications() {
    const btn = $('#notifPermBtn');
    if (ReviewAlerts.isSupported() && Notification.permission === 'default') {
      btn.hidden = false;
    }
    btn.addEventListener('click', async () => {
      const perm = await ReviewAlerts.requestPermission();
      if (perm === 'granted') {
        btn.hidden = true;
        toast('Alerts enabled');
      } else if (perm === 'denied') {
        btn.hidden = true;
        toast('Alerts blocked in browser settings');
      }
    });
    document.addEventListener('review-due', (e) => {
      const p = patients.find((x) => x.id === e.detail.patientId);
      if (p) toast(`Review due: ${p.name}`);
      renderAll();
    });
  }

  // ---------- Init ----------
  async function init() {
    initTabs();
    initModals();
    initNotifications();

    $('#patientForm').addEventListener('submit', handleAddPatient);
    $('#cameraInput').addEventListener('change', (e) => handleFiles(e.target.files));
    $('#fileInput').addEventListener('change', (e) => handleFiles(e.target.files));

    patients = await PatientDB.getAll();
    renderAll();
    ReviewAlerts.rescheduleAll(patients);

    // Re-check due reviews whenever the tab regains focus/visibility,
    // since setTimeout can be throttled while a phone screen is locked.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        ReviewAlerts.rescheduleAll(patients);
        renderAll();
      }
    });

    // Live-update "due" styling every 30s without needing a reload.
    setInterval(renderAll, 30000);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
