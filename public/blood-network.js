(function () {
  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
  const token = localStorage.getItem('redconnect_token') || '';
  const state = { category:'all', lat:null, lng:null, platform:null, osm:[], markers:[], map:null, view:'list' };

  function esc(value = '') {
    return String(value).replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
  }
  function notify(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(notify.timeout);
    notify.timeout = setTimeout(() => toast.classList.remove('show'), 3600);
  }
  async function api(path, options = {}) {
    if (window.RedConnectDB?.enabled()) return window.RedConnectDB.request(path, options);
    const response = await fetch(path, {
      ...options,
      headers:{ 'Content-Type':'application/json', ...(token ? { Authorization:`Bearer ${token}` } : {}) }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }
  function distance(a, b, c, d) {
    const radius = 6371;
    const p = Math.PI / 180;
    const x = Math.sin((c-a)*p/2) ** 2 + Math.cos(a*p) * Math.cos(c*p) * Math.sin((d-b)*p/2) ** 2;
    return +(2 * radius * Math.asin(Math.sqrt(x))).toFixed(1);
  }
  function initMap() {
    if (!window.L) return;
    state.map = L.map('networkMap', { zoomControl:true }).setView([12.9716,77.5946], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution:'© OpenStreetMap contributors' }).addTo(state.map);
  }
  function getLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('Location is unavailable in this browser.'));
      navigator.geolocation.getCurrentPosition(position => {
        state.lat = position.coords.latitude;
        state.lng = position.coords.longitude;
        resolve({ lat:state.lat, lng:state.lng });
      }, () => reject(new Error('Location permission was not available. You can still search by city.')), { timeout:10000, maximumAge:120000 });
    });
  }
  async function ensureLocation() {
    if (Number.isFinite(state.lat) && Number.isFinite(state.lng)) return true;
    $('#searchStatus').textContent = 'Requesting your current location…';
    try {
      await getLocation();
      $('#nearbyButton').textContent = 'Location enabled';
      $('#searchStatus').textContent = 'Location added. Exact coordinates stay private and are used only for this search.';
      return true;
    } catch (problem) {
      $('#searchStatus').textContent = problem.message;
      notify(problem.message);
      return false;
    }
  }
  function osmKind(tags = {}) {
    if (tags.healthcare === 'blood_donation' || tags.amenity === 'blood_bank' || /blood/i.test(tags.name || '')) return 'Blood bank';
    if (tags.amenity === 'hospital' || tags.healthcare === 'hospital') return 'Hospital';
    if (tags.amenity === 'clinic' || tags.healthcare === 'clinic') return 'Clinic';
    if (tags.amenity === 'doctors' || tags.healthcare === 'doctor') return 'Doctor';
    if (tags.amenity === 'pharmacy' || tags.healthcare === 'pharmacy') return 'Pharmacy';
    return 'Healthcare facility';
  }
  function osmAddress(tags = {}) {
    return [tags['addr:housenumber'], tags['addr:street'], tags['addr:suburb'], tags['addr:city']].filter(Boolean).join(', ') || tags['addr:full'] || 'Address not listed';
  }
  async function queryOverpass(radius) {
    const meters = Math.min(Math.max(radius * 1000, 1000), 50000);
    const query = `[out:json][timeout:18];(nwr(around:${meters},${state.lat},${state.lng})["amenity"~"hospital|clinic|doctors|pharmacy|blood_bank"];nwr(around:${meters},${state.lat},${state.lng})["healthcare"~"hospital|clinic|doctor|pharmacy|blood_donation|centre"];);out center tags 60;`;
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method:'POST',
      headers:{ 'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8' },
      body:`data=${encodeURIComponent(query)}`
    });
    if (!response.ok) throw new Error('OpenStreetMap nearby service is busy.');
    const data = await response.json();
    return (data.elements || []).map(element => {
      const lat = element.lat ?? element.center?.lat;
      const lng = element.lon ?? element.center?.lon;
      return {
        id:`osm-${element.type}-${element.id}`,
        name:element.tags?.name || osmKind(element.tags),
        type:osmKind(element.tags),
        address:osmAddress(element.tags),
        phone:element.tags?.phone || element.tags?.['contact:phone'] || '',
        open:element.tags?.opening_hours || '',
        lat, lng,
        distanceKm:lat && lng ? distance(state.lat,state.lng,lat,lng) : null,
        source:'OpenStreetMap location data'
      };
    }).filter(item => item.lat && item.lng).sort((a,b) => a.distanceKm - b.distanceKm).slice(0,30);
  }
  async function queryNominatimFallback() {
    const offset = 0.3;
    const searchKind = state.category === 'blood-banks' ? 'blood bank' : state.category === 'hospitals' ? 'hospital' : 'hospital clinic';
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.search = new URLSearchParams({
      format:'jsonv2', q:searchKind, limit:'20', bounded:'1',
      viewbox:`${state.lng-offset},${state.lat+offset},${state.lng+offset},${state.lat-offset}`
    });
    const response = await fetch(url, { headers:{ Accept:'application/json' } });
    if (!response.ok) throw new Error('Nearby medical discovery is temporarily unavailable.');
    const rows = await response.json();
    return rows.map(row => ({
      id:`osm-${row.osm_type}-${row.osm_id}`, name:row.name || row.display_name.split(',')[0],
      type:/clinic/i.test(row.type || row.display_name) ? 'Clinic' : /blood/i.test(row.display_name) ? 'Blood bank' : 'Hospital',
      address:row.display_name, phone:'', lat:Number(row.lat), lng:Number(row.lon),
      distanceKm:distance(state.lat,state.lng,Number(row.lat),Number(row.lon)), source:'OpenStreetMap location data'
    })).sort((a,b) => a.distanceKm - b.distanceKm);
  }
  async function fetchOsm(radius) {
    if (!Number.isFinite(state.lat)) return [];
    const cacheKey = `redconnect-osm-${state.lat.toFixed(2)}-${state.lng.toFixed(2)}-${radius}`;
    try {
      const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
      if (cached && Date.now() - cached.savedAt < 15 * 60000) return cached.items;
    } catch {}
    let items;
    try { items = await queryOverpass(radius); }
    catch { items = await queryNominatimFallback(); }
    try { sessionStorage.setItem(cacheKey, JSON.stringify({ savedAt:Date.now(), items })); } catch {}
    return items;
  }
  function section(title, source, cards) {
    if (!cards.length) return '';
    return `<section class="result-group"><header class="result-group-head"><h3>${esc(title)}</h3><span>${cards.length} result${cards.length === 1 ? '' : 's'} · ${esc(source)}</span></header>${cards.join('')}</section>`;
  }
  function donorCard(item) {
    const donated = item.lastDonatedAt ? `Last donated ${new Date(item.lastDonatedAt).toLocaleDateString()}` : 'Donation date not listed';
    return `<article class="network-card" data-lat="${esc(item.approximateLat)}" data-lng="${esc(item.approximateLng)}"><div class="network-card-icon">${esc(item.bloodGroup)}</div><div><h4>${esc(item.name || item.displayName || 'Blood donor')}</h4><p>${esc(item.city || 'Nearby')}${item.distanceKm != null ? ` · ~${item.distanceKm} km away` : ''}</p><div class="network-meta"><span>${item.profileVerified ? 'Verified profile' : 'Community profile'}</span><span>${esc(item.availabilityStatus || 'available')}</span><span>${esc(donated)}</span></div></div><div class="network-card-actions"><button class="request-donation" data-donor="${esc(item.id || item.userId)}">Request donation</button></div></article>`;
  }
  function organizationCard(item) {
    return `<article class="network-card" data-lat="${esc(item.approximateLat || item.lat)}" data-lng="${esc(item.approximateLng || item.lng)}"><div class="network-card-icon">ORG</div><div><h4>${esc(item.name)}</h4><p>${esc(item.type)} · ${esc(item.city)}${item.distanceKm != null ? ` · ${item.distanceKm} km` : ''}</p><div class="network-meta"><span>Verified Blood Network organization</span>${item.emergencyAvailable ? '<span>Emergency support</span>' : ''}</div></div><div class="network-card-actions"><a href="https://www.openstreetmap.org/directions?to=${encodeURIComponent(`${item.lat || item.approximateLat},${item.lng || item.approximateLng}`)}" target="_blank" rel="noopener">Directions</a></div></article>`;
  }
  function requestCard(item) {
    return `<article class="network-card" data-lat="${esc(item.approximateLat)}" data-lng="${esc(item.approximateLng)}"><div class="network-card-icon">${esc(item.bloodGroup)}</div><div><h4>${esc(item.units)} unit${Number(item.units) === 1 ? '' : 's'} needed</h4><p>${esc(item.hospital)} · ${esc(item.city)}${item.distanceKm != null ? ` · ~${item.distanceKm} km` : ''}</p><div class="network-meta"><span>${esc(item.component)}</span><span>Needed ${new Date(item.neededBy).toLocaleString()}</span></div></div><div class="network-card-actions"><a href="/#requests">View request board</a></div></article>`;
  }
  function osmCard(item) {
    return `<article class="network-card" data-lat="${item.lat}" data-lng="${item.lng}"><div class="network-card-icon">MAP</div><div><h4>${esc(item.name)}</h4><p>${esc(item.type)} · ${item.distanceKm} km</p><div class="network-meta"><span>OpenStreetMap data</span>${item.open ? `<span>${esc(item.open)}</span>` : ''}</div><p>${esc(item.address)}</p></div><div class="network-card-actions">${item.phone ? `<a href="tel:${esc(item.phone)}">Call</a>` : ''}<a href="https://www.openstreetmap.org/directions?to=${item.lat},${item.lng}" target="_blank" rel="noopener">Directions</a></div></article>`;
  }
  function render() {
    const host = $('#networkResults');
    const platform = state.platform || { donors:[], organizations:[], requests:[] };
    const parts = [
      section('Registered donors', 'RedConnect safe profiles', platform.donors.map(donorCard)),
      section('Verified blood organizations', 'RedConnect verified network', platform.organizations.map(organizationCard)),
      section('Urgent blood requests', 'RedConnect community board', platform.requests.map(requestCard)),
      state.osm.length ? '<p class="source-note"><strong>OpenStreetMap results are location data only.</strong> They do not confirm blood inventory, operating hours, or RedConnect verification. Call the facility before travelling.</p>' : '',
      section('Nearby medical services', 'OpenStreetMap location data', state.osm.map(osmCard))
    ].filter(Boolean);
    host.innerHTML = parts.length ? parts.join('') : '<div class="network-empty"><strong>No matching results found</strong><span>Try a wider distance, another category, or remove the verified-only filter.</span></div>';
    host.setAttribute('aria-busy','false');
    $$('.request-donation', host).forEach(button => button.onclick = () => requestDonation(button));
    renderMarkers();
  }
  function renderMarkers() {
    if (!state.map) return;
    state.markers.forEach(marker => marker.remove());
    state.markers = [];
    const points = [];
    if (Number.isFinite(state.lat)) {
      const marker = L.circleMarker([state.lat,state.lng], { radius:8, color:'#fff', fillColor:'#c51f34', fillOpacity:1, weight:3 }).addTo(state.map).bindPopup('Your search area');
      state.markers.push(marker);
      points.push([state.lat,state.lng]);
    }
    const platform = state.platform || { donors:[], organizations:[], requests:[] };
    [
      ...platform.donors.map(item => ({ ...item, lat:item.approximateLat, lng:item.approximateLng, label:`${item.name || item.displayName} · approximate donor area` })),
      ...platform.organizations.map(item => ({ ...item, lat:item.approximateLat || item.lat, lng:item.approximateLng || item.lng, label:`${item.name} · verified organization` })),
      ...platform.requests.map(item => ({ ...item, lat:item.approximateLat, lng:item.approximateLng, label:`${item.bloodGroup} blood request · approximate area` })),
      ...state.osm.map(item => ({ ...item, label:`${item.name} · OpenStreetMap` }))
    ].forEach(item => {
      if (!Number(item.lat) || !Number(item.lng)) return;
      const marker = L.marker([Number(item.lat),Number(item.lng)]).addTo(state.map).bindPopup(esc(item.label));
      state.markers.push(marker);
      points.push([Number(item.lat),Number(item.lng)]);
    });
    if (points.length > 1) state.map.fitBounds(points, { padding:[28,28], maxZoom:14 });
    else if (points.length === 1) state.map.setView(points[0],13);
  }
  async function requestDonation(button) {
    button.disabled = true;
    button.textContent = 'Sending…';
    try {
      await api('/api/contact-requests', { method:'POST', body:JSON.stringify({ recipientId:button.dataset.donor }) });
      button.textContent = 'Request sent';
      notify('Donation request sent. The donor can approve contact from their profile.');
    } catch (problem) {
      button.disabled = false;
      button.textContent = 'Request donation';
      notify(problem.message);
      if (/sign in|session/i.test(problem.message)) setTimeout(() => { if (confirm('Sign in is required. Go to the RedConnect sign-in page?')) location.href = '/?signin=1'; }, 200);
    }
  }
  async function runSearch() {
    const host = $('#networkResults');
    host.setAttribute('aria-busy','true');
    host.innerHTML = '<div class="network-empty"><strong>Searching the network…</strong><span>Combining platform records with nearby medical locations.</span></div>';
    const query = $('#query').value.trim();
    const nearIntent = /near me|nearby|hospital|clinic|blood bank|pharmacy|doctor/i.test(query) || ['medical','hospitals','blood-banks'].includes(state.category);
    if (nearIntent && !Number.isFinite(state.lat)) await ensureLocation();
    const params = new URLSearchParams({
      q:query, type:state.category, blood:$('#blood').value, distance:$('#distance').value,
      available:String($('#available').checked), verified:String($('#verified').checked)
    });
    if (Number.isFinite(state.lat)) { params.set('lat',state.lat); params.set('lng',state.lng); }
    try {
      const radius = Number($('#distance').value);
      const includeOsm = Number.isFinite(state.lat) && ['all','medical','hospitals','blood-banks'].includes(state.category);
      const [platform, osm] = await Promise.all([
        state.category === 'medical' ? Promise.resolve({ donors:[],organizations:[],requests:[] }) : api(`/api/network/search?${params}`),
        includeOsm ? fetchOsm(radius) : Promise.resolve([])
      ]);
      state.platform = platform;
      state.osm = osm.filter(item => {
        if (state.category === 'hospitals') return /hospital|clinic/i.test(item.type);
        if (state.category === 'blood-banks') return /blood/i.test(item.type + item.name);
        return true;
      }).filter(item => item.distanceKm <= radius);
      const total = platform.donors.length + platform.organizations.length + platform.requests.length + state.osm.length;
      $('#searchStatus').textContent = `${total} result${total === 1 ? '' : 's'} across RedConnect and OpenStreetMap${Number.isFinite(state.lat) ? ', nearest first' : ''}.`;
      render();
    } catch (problem) {
      host.setAttribute('aria-busy','false');
      host.innerHTML = `<div class="network-empty"><strong>Search could not be completed</strong><span>${esc(problem.message)}</span></div>`;
      $('#searchStatus').textContent = problem.message;
    }
  }

  $('#networkForm').onsubmit = event => { event.preventDefault(); runSearch(); };
  $$('.category-strip button').forEach(button => button.onclick = () => {
    $$('.category-strip button').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    state.category = button.dataset.category;
    runSearch();
  });
  $('#nearbyButton').onclick = async () => { if (await ensureLocation()) runSearch(); };
  $('#listView').onclick = () => {
    state.view = 'list';
    $('#listView').classList.add('active');
    $('#mapView').classList.remove('active');
    $('#networkLayout').className = 'network-layout list-only';
  };
  $('#mapView').onclick = () => {
    state.view = 'map';
    $('#mapView').classList.add('active');
    $('#listView').classList.remove('active');
    $('#networkLayout').className = window.innerWidth <= 1000 ? 'network-layout show-map' : 'network-layout map-only';
    setTimeout(() => state.map?.invalidateSize(),80);
  };
  const preset = new URLSearchParams(location.search);
  if (preset.get('q')) $('#query').value = preset.get('q');
  if (preset.get('blood')) {
    $('#blood').value = preset.get('blood');
    state.category = 'people';
    $$('.category-strip button').forEach(button => button.classList.toggle('active', button.dataset.category === 'people'));
  }
  initMap();
  if (preset.get('q') || preset.get('blood')) runSearch();
})();
