['account.css', 'ui-refresh.css', 'immersive.css', 'network-shared.css'].forEach(href => {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `/${href}`;
  document.head.appendChild(link);
});
const favicon = document.createElement('link');
favicon.rel = 'icon';
favicon.href = '/logo.svg';
document.head.appendChild(favicon);

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const modal = $('#modal');
const modalBody = $('#modalBody');
const toast = $('#toast');
let map;
let markers = [];
let currentUser = null;
let token = localStorage.getItem('redconnect_token') || '';
let pendingPhone = '';
const groups = ['O+','O-','A+','A-','B+','B-','AB+','AB-'];
const groupOptions = groups.map(group => `<option>${group}</option>`).join('');

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
}

function notify(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(notify.timeout);
  notify.timeout = setTimeout(() => toast.classList.remove('show'), 3200);
}

async function api(path, options = {}) {
  if (window.RedConnectDB?.enabled()) return window.RedConnectDB.request(path, options);
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type':'application/json', ...(token ? { Authorization:`Bearer ${token}` } : {}), ...(options.headers || {}) }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

const field = (label, name, type = 'text', attributes = '', full = '') => `<label class="${full}">${label}<input name="${name}" type="${type}" ${attributes} required></label>`;

const templates = {
  login: () => `<div class="modal-content auth-flow"><p class="modal-step">Secure sign in</p><h2>Continue with your phone</h2><p>We will send a one-time verification code. Standard SMS charges may apply.</p><form class="form-grid" id="phoneForm">${field('Mobile number','phone','tel','autocomplete="tel" inputmode="tel" placeholder="+91 98765 43210"','full')}<div class="form-error" aria-live="polite"></div><button class="primary" type="submit">Send verification code</button></form><div class="auth-divider"><span>or</span></div><button class="secondary full-width" type="button" data-switch="emailLogin">Use email and password</button></div>`,
  verifyOtp: () => `<div class="modal-content auth-flow"><p class="modal-step">Phone verification</p><h2>Enter the 6-digit code</h2><p>Sent to <strong>${esc(pendingPhone)}</strong>. The code expires shortly.</p><form class="form-grid" id="otpForm"><input name="phone" type="hidden" value="${esc(pendingPhone)}">${field('Verification code','otp','text','autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6"','full')}<div class="form-error" aria-live="polite"></div><button class="primary" type="submit">Verify and continue</button><button class="text-btn" type="button" data-switch="login">Use another number</button></form></div>`,
  emailLogin: () => `<div class="modal-content auth-flow"><p class="modal-step">Existing account</p><h2>Sign in with email</h2><p>Use this for accounts created with a password.</p><form class="form-grid" id="emailLoginForm">${field('Email','email','email','autocomplete="email"','full')}${field('Password','password','password','autocomplete="current-password"','full')}<div class="form-error" aria-live="polite"></div><button class="primary" type="submit">Sign in</button><button class="text-btn" type="button" data-switch="reset">Forgot password?</button></form></div>`,
  reset: () => `<div class="modal-content auth-flow"><p class="modal-step">Account recovery</p><h2>Reset your password</h2><p>We will send recovery instructions if the account exists.</p><form class="form-grid" id="resetForm">${field('Email','email','email','autocomplete="email"','full')}<div class="form-error" aria-live="polite"></div><button class="primary" type="submit">Send reset link</button></form></div>`,
  resetPassword: () => `<div class="modal-content auth-flow"><p class="modal-step">Choose a new password</p><h2>Secure your account</h2><p>Use at least eight characters and avoid reusing another password.</p><form class="form-grid" id="passwordUpdateForm">${field('New password','password','password','autocomplete="new-password" minlength="8"','full')}<div class="form-error" aria-live="polite"></div><button class="primary" type="submit">Update password</button></form></div>`,
  register: () => `<div class="modal-content auth-flow"><p class="modal-step">Create an account</p><h2>Join through phone verification</h2><p>Your phone becomes a verified sign-in method. Your account keeps a separate permanent user ID.</p><form class="form-grid" id="phoneForm">${field('Mobile number','phone','tel','autocomplete="tel" inputmode="tel" placeholder="+91 98765 43210"','full')}<div class="form-error" aria-live="polite"></div><button class="primary" type="submit">Send verification code</button></form><div class="auth-divider"><span>Organizations</span></div><button class="secondary full-width" type="button" data-switch="organization">Register a hospital, blood bank or NGO</button></div>`,
  profile: () => `<div class="modal-content"><p class="modal-step">${currentUser?.profileComplete ? 'Protected profile' : 'Complete your profile'}</p><h2>${currentUser?.profileComplete ? 'Edit blood profile' : 'Tell the network how you can help'}</h2><p>Your date of birth, phone, and exact location stay private.</p><form class="form-grid" id="profileForm">${field('Full name','name','text',`value="${esc(currentUser?.name || '')}" autocomplete="name"`)}<label>Blood group<select name="bloodGroup">${groups.map(group => `<option ${currentUser?.bloodGroup === group ? 'selected' : ''}>${group}</option>`).join('')}</select></label>${field('Date of birth','dateOfBirth','date',`value="${esc(currentUser?.dateOfBirth || '')}"`)}<label>Gender<select name="gender"><option value="">Prefer not to say</option>${['Female','Male','Non-binary','Other'].map(value => `<option ${currentUser?.gender === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>${field('City / area','city','text',`value="${esc(currentUser?.city || '')}"`)}${field('State','state','text',`value="${esc(currentUser?.state || '')}"`)}${field('Country','country','text',`value="${esc(currentUser?.country || 'India')}"`)}<label>Last donated <span class="field-optional">(optional)</span><input name="lastDonatedAt" type="date" value="${esc(currentUser?.lastDonatedAt?.slice?.(0,10) || currentUser?.lastDonatedAt || '')}"></label><input name="lat" type="hidden" value="${esc(currentUser?.lat || '')}"><input name="lng" type="hidden" value="${esc(currentUser?.lng || '')}"><button type="button" class="secondary full locate">Use or change current location</button><p class="field-note full" id="profileLocation">${currentUser?.city ? `Approximate public location: ${esc(currentUser.city)}` : 'No location added yet.'}</p><div class="form-error" aria-live="polite"></div><button class="primary" type="submit">Save protected profile</button></form></div>`,
  organization: () => `<div class="modal-content"><h2>Register an organization</h2><p>For hospitals, blood banks, clinics, NGOs, and donor networks. Verification is completed separately.</p><form class="form-grid" id="organizationForm">${field('Organization name','name')}${field('Contact person','contactName')}<label>Organization type<select name="type"><option>Blood bank</option><option>Hospital</option><option>Clinic</option><option>NGO</option><option>Donor network</option></select></label>${field('License / registration ID','license')}${field('Email','email','email')}${field('Phone','phone','tel')}${field('Password','password','password','minlength="8"')}${field('City','city')}${field('State','state')}${field('Address','address','text','','full')}<input name="lat" type="hidden"><input name="lng" type="hidden"><button type="button" class="secondary full locate">Use current location</button><div class="form-error"></div><button class="primary" type="submit">Submit registration</button></form></div>`,
  request: () => `<div class="modal-content"><h2>Request blood</h2><p>Share accurate details. Contact information stays protected on public pages.</p><form class="form-grid" id="requestForm">${field('Patient name','patientName')}<label>Blood group<select name="bloodGroup">${groupOptions}</select></label><label>Units needed<input name="units" type="number" min="1" max="12" value="1" required></label><label>Component<select name="component"><option>Whole blood</option><option>Packed red cells</option><option>Platelets</option><option>Plasma</option></select></label>${field('Hospital','hospital')}${field('City','city','text',`value="${esc(currentUser?.city || '')}"`)}${field('Contact phone','phone','tel',`value="${esc(currentUser?.phone || '')}"`)}${field('Needed by','neededBy','datetime-local')}<label class="full">Notes <span class="field-optional">(optional)</span><input name="notes" type="text" placeholder="Ward, doctor, or blood-bank instructions"></label><input name="lat" type="hidden"><input name="lng" type="hidden"><button type="button" class="secondary full locate">Attach current location</button><div class="form-error"></div><button class="primary" type="submit">Publish urgent request</button></form></div>`,
  account: () => `<div class="modal-content"><p class="modal-step">Protected dashboard</p><h2>Your RedConnect</h2><p>${esc(currentUser?.phone || currentUser?.email || 'Manage your account')}</p><div class="account-panel"><div class="account-row"><div><strong>${esc(currentUser?.name || 'Profile setup needed')}</strong><small>Unique ID: ${esc(currentUser?.id || '')}</small></div><span class="status-pill">${currentUser?.phoneVerified ? 'Phone verified' : 'Signed in'}</span></div>${currentUser?.role === 'donor' ? `<div class="account-row"><div><strong>Donor availability</strong><small>${currentUser.available ? 'Visible through safe, approximate discovery' : 'Paused and hidden from search'}</small></div><button class="secondary" id="availabilityToggle">${currentUser.available ? 'Pause' : 'Go available'}</button></div>` : ''}<div class="dashboard-actions"><button class="secondary" data-switch="profile">Edit protected profile</button><a class="secondary" href="/Blood-Network/">Open Blood Network</a></div>${currentUser?.role === 'organization' ? '<section><h3>Donation verification</h3><p class="field-note">Verify only records your organization can confirm.</p><div id="verificationQueue"><div class="skeleton">Loading pending records…</div></div></section>' : ''}<section><h3>Contact requests</h3><div id="contactRequests"><div class="skeleton">Loading contact requests…</div></div></section><section><h3>Your blood requests</h3><div id="myRequests"><div class="skeleton">Loading your requests…</div></div></section>${currentUser?.role !== 'organization' ? '<section><h3>Donation history</h3><p class="field-note">New records stay pending until an organization verifies them.</p><div id="donationHistory"><div class="skeleton">Loading donation history…</div></div><button class="text-btn" id="addDonation">Add a pending donation record</button></section>' : ''}<button class="secondary danger" id="logoutButton">Sign out</button></div></div>`,
  donation: () => `<div class="modal-content"><p class="modal-step">Donation history</p><h2>Add a donation record</h2><p>This record stays pending until the selected organization confirms it.</p><form class="form-grid" id="donationForm">${field('Donation date','donatedAt','date','','full')}<label class="full">Organization<select name="organizationId" id="donationOrganization" required><option value="">Loading verified organizations…</option></select></label><label class="full">Component<select name="component"><option>Whole blood</option><option>Packed red cells</option><option>Platelets</option><option>Plasma</option></select></label><div class="form-error"></div><button class="primary" type="submit">Add pending record</button></form></div>`
};

function openModal(type) {
  modalBody.innerHTML = templates[type]();
  if (!modal.open) modal.showModal();
  bindModal(type);
  setTimeout(() => modalBody.querySelector('input, select, button')?.focus(), 30);
}

async function reverseGeocode(lat, lng) {
  try {
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.search = new URLSearchParams({ format:'jsonv2', lat, lon:lng, zoom:'12', addressdetails:'1' });
    const response = await fetch(url, { headers:{ Accept:'application/json' } });
    if (!response.ok) throw new Error('Location lookup unavailable');
    const data = await response.json();
    return {
      city: data.address?.city || data.address?.town || data.address?.village || data.address?.county || '',
      state: data.address?.state || '',
      country: data.address?.country || ''
    };
  } catch { return {}; }
}

async function locateForForm(form) {
  if (!navigator.geolocation) return notify('Location is unavailable in this browser.');
  const button = $('.locate', form);
  button.disabled = true;
  button.textContent = 'Finding your location…';
  navigator.geolocation.getCurrentPosition(async position => {
    form.elements.lat.value = position.coords.latitude;
    form.elements.lng.value = position.coords.longitude;
    const place = await reverseGeocode(position.coords.latitude, position.coords.longitude);
    ['city','state','country'].forEach(key => { if (form.elements[key] && place[key]) form.elements[key].value = place[key]; });
    const label = $('#profileLocation', form);
    if (label) label.textContent = `Approximate public location: ${place.city || 'nearby area'}. Exact GPS stays private.`;
    button.disabled = false;
    button.textContent = 'Location added — change it';
    notify('Location added securely.');
  }, () => {
    button.disabled = false;
    button.textContent = 'Use or change current location';
    notify('Location permission was not available. Enter your city manually.');
  }, { timeout:10000, maximumAge:60000 });
}

function setSession(output) {
  if (output.token) {
    token = output.token;
    localStorage.setItem('redconnect_token', token);
  }
  if (output.user) currentUser = output.user;
  renderAccount();
}

function setBusy(form, busy, label) {
  const submit = form.querySelector('button[type="submit"]');
  if (!submit) return;
  if (!submit.dataset.label) submit.dataset.label = submit.textContent;
  submit.disabled = busy;
  submit.textContent = busy ? label : submit.dataset.label;
}

function bindModal(type) {
  $$('[data-switch]', modalBody).forEach(button => button.addEventListener('click', () => openModal(button.dataset.switch)));
  if (type === 'account') {
    $('#logoutButton').onclick = logout;
    $('#availabilityToggle')?.addEventListener('click', toggleAvailability);
    $('#addDonation')?.addEventListener('click', () => openModal('donation'));
    loadMyRequests();
    loadContactRequests();
    if (currentUser?.role === 'organization') loadVerificationQueue();
    else loadDonations();
    return;
  }
  const form = $('form', modalBody);
  if (!form) return;
  $('.locate', form)?.addEventListener('click', () => locateForForm(form));
  if (type === 'donation') loadDonationOrganizations();
  if (type === 'request') {
    const soon = new Date(Date.now() + 6 * 3600000);
    soon.setMinutes(soon.getMinutes() - soon.getTimezoneOffset());
    form.elements.neededBy.min = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0,16);
    form.elements.neededBy.value = soon.toISOString().slice(0,16);
  }
  form.onsubmit = async event => {
    event.preventDefault();
    const error = $('.form-error', form);
    error.textContent = '';
    setBusy(form, true, 'Please wait…');
    const data = Object.fromEntries(new FormData(form));
    try {
      if (type === 'login' || type === 'register') {
        const output = await api('/api/auth/phone/start', { method:'POST', body:JSON.stringify(data) });
        pendingPhone = output.phone || data.phone;
        openModal('verifyOtp');
        if (output.devOtp) {
          const note = document.createElement('div');
          note.className = 'dev-otp';
          note.innerHTML = `<strong>Local development code</strong><span>${esc(output.devOtp)}</span>`;
          $('.auth-flow', modalBody).appendChild(note);
        }
        return;
      }
      if (type === 'verifyOtp') {
        const output = await api('/api/auth/phone/verify', { method:'POST', body:JSON.stringify(data) });
        setSession(output);
        notify('Phone verified successfully.');
        return openModal(output.needsProfile ? 'profile' : 'account');
      }
      if (type === 'emailLogin') {
        const output = await api('/api/login', { method:'POST', body:JSON.stringify(data) });
        setSession(output);
        modal.close();
        notify('Signed in securely.');
      }
      if (type === 'reset') {
        const output = await api('/api/password-reset', { method:'POST', body:JSON.stringify(data) });
        modal.close();
        notify(output.message || 'Check your email for reset instructions.');
      }
      if (type === 'resetPassword') {
        const output = await api('/api/password-update', { method:'POST', body:JSON.stringify(data) });
        modal.close();
        notify(output.message || 'Your password has been updated.');
      }
      if (type === 'profile') {
        currentUser = await api('/api/me', { method:'PATCH', body:JSON.stringify(data) });
        renderAccount();
        modal.close();
        notify('Your protected profile was saved.');
        loadAll();
      }
      if (type === 'organization') {
        const output = await api('/api/organizations', { method:'POST', body:JSON.stringify(data) });
        setSession(output);
        modal.close();
        notify('Organization submitted for verification.');
      }
      if (type === 'request') {
        await api('/api/requests', { method:'POST', body:JSON.stringify(data) });
        modal.close();
        notify('Urgent request published.');
        loadAll();
      }
      if (type === 'donation') {
        await api('/api/donations', { method:'POST', body:JSON.stringify(data) });
        notify('Donation record added as pending verification.');
        openModal('account');
      }
    } catch (problem) {
      error.textContent = problem.message;
      setBusy(form, false);
      if (type === 'request' && /sign in/i.test(problem.message)) setTimeout(() => openModal('login'), 900);
    }
  };
}

$('.close').onclick = () => modal.close();
modal.onclick = event => { if (event.target === modal) modal.close(); };
$$('[data-open]').forEach(button => button.onclick = event => {
  if (button.dataset.open === 'account' && !currentUser) {
    event.preventDefault();
    openModal('login');
  } else openModal(button.dataset.open);
});

function dueLabel(value) {
  const hours = Math.ceil((new Date(value) - Date.now()) / 3600000);
  if (hours <= 0) return 'Past deadline';
  if (hours < 24) return `Due in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.ceil(hours / 24);
  return `Due in ${days} day${days === 1 ? '' : 's'}`;
}

function requestCard(request, mine = false) {
  const actions = mine && request.status === 'open' ? `<div class="request-actions"><button data-status="fulfilled" data-id="${esc(request.id)}">Mark fulfilled</button><button class="danger" data-status="cancelled" data-id="${esc(request.id)}">Cancel</button></div>` : '';
  return `<article class="request-card"><div class="blood-badge" aria-label="Blood group ${esc(request.bloodGroup)}">${esc(request.bloodGroup)}</div><div><h3>${esc(request.patientName || 'Patient')} needs ${Number(request.units)} unit${Number(request.units) === 1 ? '' : 's'}</h3><p>${esc(request.hospital)} · ${esc(request.city)}</p><div class="request-meta"><span>${esc(request.component)}</span><span>${esc(request.status)}</span><span>${dueLabel(request.neededBy)}</span></div>${mine && request.phone ? `<a href="tel:${esc(request.phone)}">Private contact: ${esc(request.phone)}</a>` : '<a href="/Blood-Network/">Respond through Blood Network</a>'}${actions}</div></article>`;
}

async function loadAll() {
  const list = $('#requestList');
  if (list) list.setAttribute('aria-busy', 'true');
  try {
    const [stats, requests] = await Promise.all([api('/api/stats'), api('/api/requests')]);
    $('#statDonors').textContent = stats.donors;
    $('#statOrgs').textContent = stats.organizations;
    $('#statRequests').textContent = stats.openRequests;
    $('#statFulfilled').textContent = stats.fulfilled;
    $('#activeCount').textContent = `${stats.organizations + stats.donors} donors and care teams`;
    list.innerHTML = requests.length ? requests.map(item => requestCard(item)).join('') : '<div class="empty"><strong>No urgent requests right now</strong><span>The community board is clear. Check again later.</span></div>';
  } catch {
    list.innerHTML = '<div class="empty"><strong>Requests could not be loaded</strong><span>Check your connection and refresh the page.</span></div>';
  } finally {
    if (list) list.setAttribute('aria-busy', 'false');
  }
}

function initMap() {
  if (!window.L || !$('#map')) return;
  map = L.map('map', { zoomControl:false }).setView([12.9716, 77.5946], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution:'© OpenStreetMap contributors' }).addTo(map);
  L.control.zoom({ position:'bottomleft' }).addTo(map);
}

$('#searchForm').onsubmit = event => {
  event.preventDefault();
  const button = $('#searchForm button');
  button.disabled = true;
  button.textContent = 'Finding nearby help…';
  $('#results').innerHTML = '<div class="empty"><strong>Searching nearby</strong><span>Checking compatible donors and verified organizations.</span></div>';
  $('#locationHint').textContent = 'Requesting your current location…';
  if (!navigator.geolocation) return search(12.9716, 77.5946, true);
  navigator.geolocation.getCurrentPosition(position => {
    window.dispatchEvent(new CustomEvent('redconnect:location', { detail:{ lat:position.coords.latitude, lng:position.coords.longitude } }));
    search(position.coords.latitude, position.coords.longitude);
  }, () => search(12.9716, 77.5946, true), { timeout:8000 });
};

async function search(lat, lng, fallback = false) {
  const button = $('#searchForm button');
  try {
    const blood = $('#searchBlood').value;
    const query = `blood=${encodeURIComponent(blood)}&lat=${lat}&lng=${lng}`;
    const [donors, organizations] = await Promise.all([api(`/api/donors?${query}`), api(`/api/organizations?${query}`)]);
    const rows = [...donors.map(item => ({ ...item, kind:'Donor' })), ...organizations.map(item => ({ ...item, kind:'Organization' }))].sort((a,b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
        $('#results').innerHTML = rows.length ? rows.map(item => `<article class="result"><strong>${esc(item.name)} ${item.bloodGroup ? `· ${esc(item.bloodGroup)}` : ''}</strong><span>${esc(item.kind)} · ${esc(item.city)}${item.distanceKm != null ? ` · ~${item.distanceKm} km` : ''}</span>${item.kind === 'Donor' ? `<span>${item.profileVerified ? 'Verified profile' : 'Community profile'} · ${esc(item.availabilityStatus || 'available')}</span><a href="/Blood-Network/?blood=${encodeURIComponent(blood || item.bloodGroup || '')}">Request donation</a>` : `<span>${item.verified ? 'Verified Blood Network organization' : 'Organization'}</span><a href="/Blood-Network/?q=${encodeURIComponent(item.name)}">View organization</a>`}</article>`).join('') : '<div class="empty"><strong>No exact matches yet</strong><span>Try another blood group or open Blood Network for broader discovery.</span></div>';
    $('#locationHint').textContent = fallback ? `${rows.length} result${rows.length === 1 ? '' : 's'} near the Bengaluru sample area.` : `${rows.length} compatible result${rows.length === 1 ? '' : 's'}, nearest first. Exact donor locations stay private.`;
    if (map) {
      markers.forEach(marker => marker.remove());
      markers = [];
      map.setView([lat, lng], 12);
      markers.push(L.circleMarker([lat,lng], { radius:8, color:'#fff', fillColor:'#c51f34', fillOpacity:1, weight:3 }).addTo(map).bindPopup('Your search area'));
      rows.forEach(item => {
        const markerLat = item.kind === 'Donor' ? item.approximateLat : item.lat;
        const markerLng = item.kind === 'Donor' ? item.approximateLng : item.lng;
        if (markerLat && markerLng) markers.push(L.marker([markerLat, markerLng]).addTo(map).bindPopup(`<strong>${esc(item.name)}</strong><br>${esc(item.kind)}${item.kind === 'Donor' ? '<br>Approximate area' : ''}`));
      });
    }
  } catch (problem) {
    $('#results').innerHTML = `<div class="empty"><strong>Search could not be completed</strong><span>${esc(problem.message)}</span></div>`;
    notify(problem.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Find help near me';
  }
}

function renderAccount() {
  const target = $('#accountActions');
  if (!currentUser) {
    target.innerHTML = '<button class="text-btn" data-open="login">Sign in</button><button class="primary small" data-open="request">Request blood</button>';
  } else {
    const firstName = currentUser.name?.split(' ')[0] || 'Member';
    target.innerHTML = `<div class="account-chip"><span>Hi, ${esc(firstName)}</span><button class="secondary small" data-open="account">Profile</button><button class="primary small" data-open="request">Request blood</button></div>`;
  }
  $$('[data-open]', target).forEach(button => button.onclick = () => openModal(button.dataset.open));
}

async function restoreSession() {
  try {
    if (!token && !window.RedConnectDB?.enabled()) return renderAccount();
    currentUser = await api('/api/me');
    renderAccount();
    if (!currentUser.profileComplete) openModal('profile');
  } catch { logout(false); }
}

async function logout(show = true) {
  if (window.RedConnectDB?.enabled()) await window.RedConnectDB.signOut();
  token = '';
  currentUser = null;
  localStorage.removeItem('redconnect_token');
  if (modal.open) modal.close();
  renderAccount();
  if (show) notify('Signed out safely.');
}

async function toggleAvailability() {
  try {
    currentUser = await api('/api/me', { method:'PATCH', body:JSON.stringify({ available:!currentUser.available }) });
    notify(currentUser.available ? 'You are visible through safe donor discovery.' : 'Your donor availability is paused.');
    openModal('account');
    loadAll();
  } catch (problem) { notify(problem.message); }
}

async function loadMyRequests() {
  const host = $('#myRequests');
  try {
    const rows = await api('/api/requests?mine=true');
    host.innerHTML = rows.length ? rows.map(item => requestCard(item, true)).join('') : '<div class="empty"><strong>No requests posted</strong><span>Your requests will appear here.</span></div>';
    $$('[data-status]', host).forEach(button => button.onclick = () => updateRequest(button.dataset.id, button.dataset.status));
  } catch (problem) { host.innerHTML = `<div class="empty"><strong>Could not load requests</strong><span>${esc(problem.message)}</span></div>`; }
}

async function updateRequest(id, status) {
  try {
    await api(`/api/requests/${id}`, { method:'PATCH', body:JSON.stringify({ status }) });
    notify(status === 'fulfilled' ? 'Request marked fulfilled.' : 'Request cancelled.');
    loadMyRequests();
    loadAll();
  } catch (problem) { notify(problem.message); }
}

async function loadContactRequests() {
  const host = $('#contactRequests');
  try {
    const rows = await api('/api/contact-requests');
    host.innerHTML = rows.length ? rows.map(item => `<article class="dashboard-item"><div><strong>${esc(item.otherName)}</strong><small>${item.direction === 'incoming' ? 'Asked to contact you' : 'Your donation request'} · ${esc(item.status)}</small>${item.otherPhone ? `<a href="tel:${esc(item.otherPhone)}">${esc(item.otherPhone)}</a>` : ''}</div>${item.direction === 'incoming' && item.status === 'pending' ? `<div class="request-actions"><button data-contact-status="approved" data-id="${esc(item.id)}">Approve</button><button class="danger" data-contact-status="declined" data-id="${esc(item.id)}">Decline</button></div>` : ''}</article>`).join('') : '<div class="empty"><strong>No contact requests</strong><span>Donation requests and approvals appear here.</span></div>';
    $$('[data-contact-status]', host).forEach(button => button.onclick = () => respondToContact(button.dataset.id, button.dataset.contactStatus));
  } catch (problem) { host.innerHTML = `<div class="empty"><strong>Could not load contacts</strong><span>${esc(problem.message)}</span></div>`; }
}

async function respondToContact(id, status) {
  try {
    await api(`/api/contact-requests/${id}`, { method:'PATCH', body:JSON.stringify({ status }) });
    notify(status === 'approved' ? 'Contact approved. Your phone is now shared with this requester.' : 'Contact request declined.');
    loadContactRequests();
  } catch (problem) { notify(problem.message); }
}

async function loadDonations() {
  const host = $('#donationHistory');
  try {
    const rows = await api('/api/donations');
    host.innerHTML = rows.length ? rows.map(item => `<article class="dashboard-item"><div><strong>${new Date(item.donatedAt).toLocaleDateString()}</strong><small>${esc(item.component)} · ${esc(item.verificationStatus || 'pending')}</small></div></article>`).join('') : '<div class="empty"><strong>No donation history yet</strong><span>Add a record after donating. It remains pending until verified.</span></div>';
  } catch (problem) { host.innerHTML = `<div class="empty"><strong>Could not load history</strong><span>${esc(problem.message)}</span></div>`; }
}

async function loadDonationOrganizations() {
  const select = $('#donationOrganization');
  try {
    const rows = await api('/api/organizations');
    select.innerHTML = '<option value="">Select the organization that received the donation</option>' + rows.map(item => `<option value="${esc(item.id)}">${esc(item.name)} · ${esc(item.city)}</option>`).join('');
  } catch (problem) {
    select.innerHTML = '<option value="">Organizations could not be loaded</option>';
    $('.form-error', select.form).textContent = problem.message;
  }
}

async function loadVerificationQueue() {
  const host = $('#verificationQueue');
  try {
    const rows = await api('/api/donations?pending=true');
    host.innerHTML = rows.length ? rows.map(item => `<article class="dashboard-item"><div><strong>${esc(item.donorName || 'RedConnect donor')}</strong><small>${new Date(item.donatedAt).toLocaleDateString()} · ${esc(item.component)}</small></div><div class="request-actions"><button data-verification="verified" data-id="${esc(item.id)}">Verify</button><button class="danger" data-verification="rejected" data-id="${esc(item.id)}">Reject</button></div></article>`).join('') : '<div class="empty"><strong>No pending records</strong><span>Donation records assigned to your organization appear here.</span></div>';
    $$('[data-verification]', host).forEach(button => button.onclick = () => verifyDonation(button.dataset.id, button.dataset.verification));
  } catch (problem) { host.innerHTML = `<div class="empty"><strong>Could not load verification queue</strong><span>${esc(problem.message)}</span></div>`; }
}

async function verifyDonation(id, verificationStatus) {
  try {
    await api(`/api/donations/${id}`, { method:'PATCH', body:JSON.stringify({ verificationStatus }) });
    notify(verificationStatus === 'verified' ? 'Donation verified.' : 'Donation record rejected.');
    loadVerificationQueue();
  } catch (problem) { notify(problem.message); }
}

const menu = $('.menu');
menu.onclick = () => {
  const nav = $('.nav');
  const open = nav.classList.toggle('open');
  menu.setAttribute('aria-expanded', String(open));
  menu.textContent = open ? 'Close' : 'Menu';
};
$$('#mainNav a').forEach(link => link.onclick = () => {
  $('.nav').classList.remove('open');
  menu.setAttribute('aria-expanded', 'false');
  menu.textContent = 'Menu';
});

window.addEventListener('redconnect:requests-changed', loadAll);
window.addEventListener('redconnect:password-recovery', () => openModal('resetPassword'));
initMap();
loadAll();
restoreSession();
if (new URLSearchParams(location.search).get('signin')) setTimeout(() => openModal('login'), 100);
