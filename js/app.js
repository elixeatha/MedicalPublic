(() => {
  'use strict';

  let patients = [];
  let pendingImages = []; // { id, dataUrl, name } for the New Patient form
  let activeDropdownPatientId = null; // patient currently targeted by the review modal

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  // ---------- Manual ordering helpers ----------
  // Each patient carries an `order` number scoped to its current status list;
  // lower sorts first. New patients are prepended to Patients; moving a
  // patient to another tab appends it to the bottom of that tab.
  function ordersFor(status) {
    return patients.filter((p) => p.status === status).map((p) => p.order || 0);
  }

  function orderAtTop(status) {
    const orders = ordersFor(status);
    return orders.length ? Math.min(...orders) - 1 : 0;
  }

  function orderAtBottom(status) {
    const orders = ordersFor(status);
    return orders.length ? Math.max(...orders) + 1 : 0;
  }

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

  // ---------- Migrate records saved before notes/ordering existed ----------
  async function normalizePatients(list) {
    const byStatus = {};
    let changed = false;
    list.forEach((p) => {
      if (!p.notes) { p.notes = []; changed = true; }
      (byStatus[p.status] = byStatus[p.status] || []).push(p);
    });
    for (const status of Object.keys(byStatus)) {
      const group = byStatus[status];
      if (group.every((p) => typeof p.order === 'number')) continue;
      group.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      group.forEach((p, i) => {
        if (typeof p.order !== 'number') { p.order = i; changed = true; }
      });
    }
    if (changed) {
      await Promise.all(list.map((p) => PatientDB.put(p)));
    }
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
      notes: [],
      order: orderAtTop('active'),
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
        <div class="drag-handle" aria-label="Drag to reorder" title="Drag to reorder">⠿</div>
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
          <option value="cath_lab" ${p.status === 'cath_lab' ? 'disabled' : ''}>Cath Lab</option>
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

  function byOrder(list) {
    return list.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  function renderAll() {
    const active = byOrder(patients.filter((p) => p.status === 'active'));
    const discuss = byOrder(patients.filter((p) => p.status === 'discuss'));
    const review = byOrder(patients.filter((p) => p.status === 'repeat_review'));
    const cathlab = byOrder(patients.filter((p) => p.status === 'cath_lab'));

    renderList('#patientsList', '#patientsEmpty', active);
    renderList('#discussList', '#discussEmpty', discuss);
    renderList('#reviewList', '#reviewEmpty', review);
    renderList('#cathlabList', '#cathlabEmpty', cathlab);

    $('#count-patients').textContent = active.length || '';
    $('#count-discuss').textContent = discuss.length || '';
    $('#count-review').textContent = review.length || '';
    $('#count-cathlab').textContent = cathlab.length || '';
  }

  // ---------- Status changes ----------
  async function handleStatusChange(id, status) {
    const p = patients.find((x) => x.id === id);
    if (!p) return;
    p.status = status;
    p.order = orderAtBottom(status);
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
      : status === 'cath_lab' ? 'Moved to Cath Lab'
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
  function notesListHtml(p) {
    const notes = (p.notes || []).slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    if (!notes.length) {
      return `<p class="notes-empty">No additional notes yet.</p>`;
    }
    return `<div class="notes-list">${notes.map((n) => `
        <div class="note-item">
          <span class="note-time">${new Date(n.createdAt).toLocaleString()}</span>
          <p class="note-text">${escapeHtml(n.text)}</p>
        </div>`).join('')}</div>`;
  }

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
      <div class="notes-section">
        <h3>Additional Information / Notes</h3>
        ${notesListHtml(p)}
        <div class="notes-add">
          <textarea id="newNoteText" rows="2" placeholder="Add additional information..."></textarea>
          <button type="button" id="addNoteBtn" class="btn secondary-btn">Add note</button>
        </div>
      </div>
    `;
    $$('.detail-images img', $('#detailBody')).forEach((img) => {
      img.addEventListener('click', () => openFullImage(img.dataset.full));
    });
    $('#addNoteBtn').addEventListener('click', () => addNote(p.id));
    $('#detailModal').hidden = false;
  }

  async function addNote(id) {
    const p = patients.find((x) => x.id === id);
    if (!p) return;
    const textarea = $('#newNoteText');
    const text = textarea.value.trim();
    if (!text) {
      toast('Note is empty');
      return;
    }
    if (!p.notes) p.notes = [];
    p.notes.push({ id: uid(), text, createdAt: new Date().toISOString() });
    await PatientDB.put(p);
    openDetail(id);
    renderAll();
    toast('Note added');
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
    p.order = orderAtBottom('repeat_review');
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

  // ---------- Drag-to-reorder ----------
  // Pointer Events (not native HTML5 drag/drop) so this works with touch on
  // phones as well as mouse on desktop. The listener is attached once to
  // each list container (event delegation), so it survives renderList()
  // rebuilding the container's innerHTML on every render.
  function makeSortable(container) {
    let dragEl = null;

    container.addEventListener('pointerdown', (e) => {
      const handle = e.target.closest('.drag-handle');
      if (!handle) return;
      const card = handle.closest('.patient-card');
      if (!card) return;
      e.preventDefault();
      dragEl = card;
      card.classList.add('dragging');
      try { handle.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    });

    function onMove(e) {
      if (!dragEl) return;
      const cards = $$('.patient-card', container).filter((c) => c !== dragEl);
      for (const sibling of cards) {
        const rect = sibling.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        if (e.clientY < mid && sibling.previousElementSibling !== dragEl) {
          container.insertBefore(dragEl, sibling);
          break;
        } else if (e.clientY >= mid && sibling.nextElementSibling !== dragEl) {
          container.insertBefore(dragEl, sibling.nextSibling);
          break;
        }
      }
    }

    async function onUp() {
      if (!dragEl) return;
      dragEl.classList.remove('dragging');
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);

      const ids = $$('.patient-card', container).map((c) => c.dataset.id);
      dragEl = null;

      await Promise.all(ids.map(async (id, index) => {
        const p = patients.find((x) => x.id === id);
        if (!p || p.order === index) return;
        p.order = index;
        await PatientDB.put(p);
      }));
    }
  }

  function initSortableLists() {
    ['#patientsList', '#discussList', '#reviewList', '#cathlabList'].forEach((sel) => {
      makeSortable($(sel));
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
    await normalizePatients(patients);
    initSortableLists();
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
