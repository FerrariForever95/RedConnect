const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8080);
const PUBLIC = path.join(__dirname, 'public');
const DATA = path.join(__dirname, 'data', 'store.json');
const SESSION_SECRET = process.env.SESSION_SECRET || 'redconnect-local-development-secret-change-in-production';
const LOCAL_OTP_ENABLED = process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEV_OTP === 'true';
const otpChallenges = new Map();

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.warn('SESSION_SECRET is not set. Add it in production so login sessions stay private and stable.');
}

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const readStore = () => {
  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  if (!Array.isArray(data.auth_users)) {
    return {
      users:data.users || [], organizations:data.organizations || [], requests:data.requests || [],
      donations:data.donations || [], contactRequests:data.contactRequests || [], requestMatches:data.requestMatches || []
    };
  }

  const profiles = new Map((data.rc_user_profiles || []).map(row => [row.user_id, row]));
  const locations = new Map((data.rc_user_locations || []).map(row => [row.user_id, row]));
  const availability = new Map((data.rc_donor_availability || []).map(row => [row.user_id, row]));
  const users = data.auth_users.map(account => {
    const profile = profiles.get(account.id) || {};
    const location = locations.get(account.id) || {};
    const donor = availability.get(account.id) || {};
    return {
      id:account.id, email:account.email || '', password:account.password_hash || '', phone:account.phone || profile.phone_number || '',
      phoneVerified:Boolean(account.phone_verified ?? profile.phone_verified), role:profile.role || account.role || 'donor',
      organizationId:account.organization_id || null, name:profile.full_name || '', bloodGroup:profile.blood_group || '',
      dateOfBirth:profile.date_of_birth || '', gender:profile.gender || '', city:profile.city || location.city || '',
      state:profile.state || location.state || '', country:profile.country || location.country || 'India',
      lastDonatedAt:profile.last_donated_at || null, donationCount:Number(profile.donation_count || 0),
      nextEligibleDate:profile.next_eligible_date || null, profileComplete:Boolean(profile.profile_complete),
      profileVerified:Boolean(profile.profile_verified), available:Boolean(donor.is_available),
      availabilityStatus:donor.status || profile.availability_status || 'unavailable',
      lat:Number.isFinite(Number(location.latitude)) ? Number(location.latitude) : undefined,
      lng:Number.isFinite(Number(location.longitude)) ? Number(location.longitude) : undefined,
      createdAt:account.created_at || profile.created_at, updatedAt:account.updated_at || profile.updated_at
    };
  });
  const inventory = new Map();
  for (const row of data.rc_organization_inventory || []) {
    if (!inventory.has(row.organization_id)) inventory.set(row.organization_id, {});
    inventory.get(row.organization_id)[row.blood_group] = Number(row.units || 0);
  }
  const services = new Map();
  for (const row of data.rc_organization_services || []) {
    if (!services.has(row.organization_id)) services.set(row.organization_id, []);
    services.get(row.organization_id).push(row.service);
  }
  const organizationLocations = new Map((data.rc_organization_locations || []).map(row => [row.organization_id, row]));
  const organizations = (data.rc_organizations || []).map(row => {
    const location = organizationLocations.get(row.id) || {};
    return {
      id:row.id, ownerId:row.owner_id || null, name:row.name, type:row.type, phone:row.phone, email:row.email,
      city:row.city || location.city, state:row.state || location.state || '', address:row.address || location.address,
      license:row.license, lat:Number(row.lat ?? location.latitude), lng:Number(row.lng ?? location.longitude),
      verified:Boolean(row.verified), emergencyAvailable:Boolean(row.emergency_available), openNow:row.open_now,
      services:services.get(row.id) || [], inventory:inventory.get(row.id) || {}, createdAt:row.created_at, updatedAt:row.updated_at
    };
  });
  return {
    users, organizations,
    requests:(data.rc_blood_requests || []).map(row => ({ id:row.id, ownerId:row.owner_id, patientName:row.patient_name, bloodGroup:row.blood_group, units:row.units, component:row.component, hospital:row.hospital, city:row.city, phone:row.phone, notes:row.notes, neededBy:row.needed_by, lat:row.lat, lng:row.lng, status:row.status, createdAt:row.created_at, updatedAt:row.updated_at })),
    donations:(data.rc_donation_history || []).map(row => ({ id:row.donation_id, userId:row.user_id, donatedAt:row.donated_at, organizationId:row.organization_id, component:row.component, verificationStatus:row.verification_status, verifiedBy:row.verified_by, verifiedAt:row.verified_at, createdAt:row.created_at })),
    contactRequests:(data.rc_contact_requests || []).map(row => ({ id:row.id, requesterId:row.requester_id, recipientId:row.recipient_id, bloodRequestId:row.blood_request_id, message:row.message, status:row.status, createdAt:row.created_at, updatedAt:row.updated_at })),
    requestMatches:data.rc_request_matches || []
  };
};
const writeStore = data => {
  const output = {
    auth_users:data.users.map(user => ({
      id:user.id, email:user.email || '', password_hash:user.password || '', phone:user.phone || '', phone_verified:Boolean(user.phoneVerified),
      role:user.role || 'donor', organization_id:user.organizationId || null, created_at:user.createdAt || now(), updated_at:user.updatedAt || now()
    })),
    rc_user_profiles:data.users.map(user => ({
      user_id:user.id, full_name:user.name || '', phone_number:user.phone || '', phone_verified:Boolean(user.phoneVerified),
      blood_group:user.bloodGroup || null, date_of_birth:user.dateOfBirth || null, gender:user.gender || null,
      city:user.city || '', state:user.state || '', country:user.country || 'India', last_donated_at:user.lastDonatedAt || null,
      donation_count:Number(user.donationCount || 0), next_eligible_date:user.nextEligibleDate || null,
      availability_status:user.availabilityStatus || (user.available ? 'available' : 'unavailable'),
      profile_verified:Boolean(user.profileVerified), profile_complete:Boolean(user.profileComplete), role:user.role || 'donor',
      created_at:user.createdAt || now(), updated_at:user.updatedAt || now()
    })),
    rc_user_locations:data.users.filter(user => Number.isFinite(user.lat) && Number.isFinite(user.lng)).map(user => ({
      user_id:user.id, latitude:user.lat, longitude:user.lng, city:user.city || '', state:user.state || '', country:user.country || 'India', updated_at:user.updatedAt || now()
    })),
    rc_donor_availability:data.users.filter(user => user.role === 'donor').map(user => ({
      user_id:user.id, is_available:Boolean(user.available), status:user.availabilityStatus || (user.available ? 'available' : 'unavailable'), updated_at:user.updatedAt || now()
    })),
    rc_organizations:data.organizations.map(org => ({
      id:org.id, owner_id:org.ownerId || null, name:org.name, type:org.type, phone:org.phone, email:org.email,
      city:org.city, state:org.state || '', address:org.address, license:org.license, lat:org.lat, lng:org.lng,
      verified:Boolean(org.verified), emergency_available:Boolean(org.emergencyAvailable), open_now:org.openNow ?? null,
      created_at:org.createdAt || now(), updated_at:org.updatedAt || now()
    })),
    rc_organization_locations:data.organizations.filter(org => Number.isFinite(org.lat) && Number.isFinite(org.lng)).map(org => ({
      id:`${org.id}-main`, organization_id:org.id, label:'Main location', address:org.address, city:org.city,
      state:org.state || '', country:org.country || 'India', latitude:org.lat, longitude:org.lng, created_at:org.createdAt || now()
    })),
    rc_organization_services:data.organizations.flatMap(org => (org.services || []).map(service => ({ organization_id:org.id, service, emergency_available:Boolean(org.emergencyAvailable), created_at:org.createdAt || now() }))),
    rc_organization_inventory:data.organizations.flatMap(org => Object.entries(org.inventory || {}).map(([bloodGroup, units]) => ({ organization_id:org.id, blood_group:bloodGroup, units:Number(units || 0), updated_at:org.updatedAt || now() }))),
    rc_blood_requests:data.requests.map(request => ({ id:request.id, owner_id:request.ownerId, patient_name:request.patientName, blood_group:request.bloodGroup, units:request.units, component:request.component, hospital:request.hospital, city:request.city, phone:request.phone, notes:request.notes || '', needed_by:request.neededBy, lat:request.lat, lng:request.lng, status:request.status, created_at:request.createdAt, updated_at:request.updatedAt || request.createdAt })),
    rc_donation_history:data.donations.map(donation => ({ donation_id:donation.id, user_id:donation.userId, donated_at:donation.donatedAt, organization_id:donation.organizationId || null, component:donation.component, verification_status:donation.verificationStatus, verified_by:donation.verifiedBy || null, verified_at:donation.verifiedAt || null, created_at:donation.createdAt })),
    rc_contact_requests:data.contactRequests.map(item => ({ id:item.id, requester_id:item.requesterId, recipient_id:item.recipientId, blood_request_id:item.bloodRequestId || null, message:item.message || '', status:item.status, created_at:item.createdAt, updated_at:item.updatedAt || item.createdAt })),
    rc_request_matches:data.requestMatches || []
  };
  fs.writeFileSync(DATA, JSON.stringify(output, null, 2));
};
const hash = (password, salt = crypto.randomBytes(16).toString('hex')) => `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
const verify = (password, saved = '') => {
  const [salt, key] = saved.split(':');
  if (!salt || !key) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(key, 'hex');
  return candidate.length === stored.length && crypto.timingSafeEqual(stored, candidate);
};
const json = (res, status, payload) => {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS'
  });
  res.end(JSON.stringify(payload));
};
const body = req => new Promise((resolve, reject) => {
  let raw = '';
  req.on('data', chunk => {
    raw += chunk;
    if (raw.length > 1e6) req.destroy();
  });
  req.on('end', () => {
    try { resolve(raw ? JSON.parse(raw) : {}); } catch (error) { reject(error); }
  });
});
const sign = value => crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
const createToken = userId => {
  const payload = Buffer.from(JSON.stringify({ userId, exp: Date.now() + 7 * 86400000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
};
const auth = (req, store) => {
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const [payload, signature] = token.split('.');
    const expected = payload ? sign(payload) : '';
    if (!payload || !signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (session.exp < Date.now()) return null;
    return store.users.find(user => user.id === session.userId) || null;
  } catch { return null; }
};
const normalizePhone = value => {
  const phone = String(value || '').replace(/[\s()-]/g, '');
  return phone.startsWith('+') ? phone : `+91${phone.replace(/^0/, '')}`;
};
const distance = (a, b, c, d) => {
  const radius = 6371;
  const p = Math.PI / 180;
  const x = Math.sin((c - a) * p / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin((d - b) * p / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(x));
};
const compatible = {
  'O-':['O-'], 'O+':['O-','O+'], 'A-':['O-','A-'], 'A+':['O-','O+','A-','A+'],
  'B-':['O-','B-'], 'B+':['O-','O+','B-','B+'], 'AB-':['O-','A-','B-','AB-'],
  'AB+':['O-','O+','A-','A+','B-','B+','AB-','AB+']
};
const queryNumber = (url, name) => url.searchParams.has(name) ? Number(url.searchParams.get(name)) : Number.NaN;
const privateUser = user => {
  const { password, ...safe } = user;
  return safe;
};
const publicDonor = (user, lat, lng) => {
  const hasOrigin = Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(user.lat) && Number.isFinite(user.lng);
  const distanceKm = hasOrigin ? +distance(lat, lng, user.lat, user.lng).toFixed(1) : null;
  const parts = String(user.name || 'Donor').split(' ');
  return {
    id: user.id,
    name: user.profileVerified ? user.name : `${parts[0]} ${parts[1]?.[0] || ''}.`.trim(),
    bloodGroup: user.bloodGroup,
    city: user.city,
    state: user.state || '',
    availabilityStatus: user.availabilityStatus || (user.available ? 'available' : 'unavailable'),
    profileVerified: Boolean(user.profileVerified),
    lastDonatedAt: user.lastDonatedAt || null,
    donationCount: Number(user.donationCount || 0),
    distanceKm,
    approximateLat: Number.isFinite(user.lat) ? +user.lat.toFixed(2) : null,
    approximateLng: Number.isFinite(user.lng) ? +user.lng.toFixed(2) : null
  };
};
const requireUser = (req, res, store, message = 'Please sign in to continue.') => {
  const user = auth(req, store);
  if (!user) json(res, 401, { error: message });
  return user;
};

async function api(req, res, url) {
  const store = readStore();
  if (req.method === 'OPTIONS') return json(res, 204, {});

  if (req.method === 'POST' && url.pathname === '/api/auth/phone/start') {
    if (!LOCAL_OTP_ENABLED) return json(res, 503, { error:'Configure Supabase phone authentication and an SMS provider for production OTP.' });
    const data = await body(req);
    const phone = normalizePhone(data.phone);
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) return json(res, 400, { error: 'Enter a valid phone number with country code.' });
    const code = String(Math.floor(100000 + Math.random() * 900000));
    otpChallenges.set(phone, { digest: sign(`${phone}:${code}`), expiresAt: Date.now() + 10 * 60000, attempts: 0 });
    console.log(`[RedConnect local OTP] ${phone}: ${code}`);
    return json(res, 200, { phone, sent:true, devOtp:code, expiresInSeconds:600 });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/phone/verify') {
    const data = await body(req);
    const phone = normalizePhone(data.phone);
    const challenge = otpChallenges.get(phone);
    if (!challenge || challenge.expiresAt < Date.now()) return json(res, 400, { error: 'This code expired. Request a new one.' });
    challenge.attempts += 1;
    if (challenge.attempts > 5) {
      otpChallenges.delete(phone);
      return json(res, 429, { error: 'Too many attempts. Request a new code.' });
    }
    const candidate = sign(`${phone}:${String(data.otp || '')}`);
    if (candidate.length !== challenge.digest.length || !crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(challenge.digest))) return json(res, 400, { error: 'The verification code is incorrect.' });
    otpChallenges.delete(phone);
    let user = store.users.find(item => normalizePhone(item.phone) === phone);
    if (!user) {
      user = {
        id: id(), name: '', phone, phoneVerified: true, role: 'donor', profileComplete: false,
        available: false, availabilityStatus: 'unavailable', profileVerified: false,
        donationCount: 0, createdAt: now(), updatedAt: now()
      };
      store.users.push(user);
    } else {
      user.phoneVerified = true;
      user.updatedAt = now();
    }
    writeStore(store);
    return json(res, 200, { token: createToken(user.id), user: privateUser(user), needsProfile: !user.profileComplete });
  }

  if (req.method === 'POST' && url.pathname === '/api/login') {
    const data = await body(req);
    const user = store.users.find(item => item.email && item.email.toLowerCase() === String(data.email || '').toLowerCase());
    if (!user || !verify(data.password, user.password)) return json(res, 401, { error: 'Incorrect email or password.' });
    return json(res, 200, { token: createToken(user.id), user: privateUser(user) });
  }

  if (req.method === 'POST' && url.pathname === '/api/password-reset') {
    return json(res, 200, { message: 'If that account exists, reset instructions will be sent. Configure Supabase to deliver production reset emails.' });
  }

  if (req.method === 'POST' && url.pathname === '/api/password-update') {
    const user = requireUser(req, res, store);
    if (!user) return;
    const data = await body(req);
    if (String(data.password || '').length < 8) return json(res, 400, { error:'Password must contain at least 8 characters.' });
    user.password = hash(data.password);
    user.updatedAt = now();
    writeStore(store);
    return json(res, 200, { message:'Password updated.' });
  }

  if (req.method === 'GET' && url.pathname === '/api/me') {
    const user = requireUser(req, res, store, 'Your session has expired. Please sign in again.');
    if (!user) return;
    return json(res, 200, privateUser(user));
  }

  if (req.method === 'PATCH' && url.pathname === '/api/me') {
    const user = requireUser(req, res, store);
    if (!user) return;
    const data = await body(req);
    const fields = ['name','bloodGroup','dateOfBirth','gender','city','state','country','lastDonatedAt','availabilityStatus'];
    fields.forEach(key => { if (data[key] !== undefined) user[key] = String(data[key]).trim(); });
    if (Number.isFinite(Number(data.lat))) user.lat = Number(data.lat);
    if (Number.isFinite(Number(data.lng))) user.lng = Number(data.lng);
    if (typeof data.available === 'boolean') {
      user.available = data.available;
      user.availabilityStatus = data.available ? 'available' : 'unavailable';
    }
    user.profileComplete = Boolean(user.name && user.bloodGroup && user.city && user.country);
    user.nextEligibleDate = user.lastDonatedAt ? new Date(new Date(user.lastDonatedAt).getTime() + 90 * 86400000).toISOString().slice(0, 10) : null;
    user.updatedAt = now();
    writeStore(store);
    return json(res, 200, privateUser(user));
  }

  if (req.method === 'POST' && url.pathname === '/api/register') {
    const data = await body(req);
    const required = ['name','email','password','phone','bloodGroup','city'];
    if (required.some(key => !String(data[key] || '').trim())) return json(res, 400, { error: 'Please complete every required field.' });
    if (String(data.password).length < 8) return json(res, 400, { error: 'Password must contain at least 8 characters.' });
    if (store.users.some(user => user.email?.toLowerCase() === data.email.toLowerCase())) return json(res, 409, { error: 'An account already exists for this email.' });
    const user = {
      id: id(), name: data.name.trim(), email: data.email.toLowerCase(), password: hash(data.password),
      phone: normalizePhone(data.phone), phoneVerified: false, bloodGroup: data.bloodGroup, city: data.city,
      state: data.state || '', country: data.country || 'India', lat: Number(data.lat) || 12.9716,
      lng: Number(data.lng) || 77.5946, role: data.role === 'patient' ? 'patient' : 'donor',
      available: data.role !== 'patient', availabilityStatus: data.role !== 'patient' ? 'available' : 'unavailable',
      profileComplete: true, profileVerified: false, donationCount: 0, createdAt: now(), updatedAt: now()
    };
    store.users.push(user);
    writeStore(store);
    return json(res, 201, { token: createToken(user.id), user: privateUser(user) });
  }

  if (req.method === 'POST' && url.pathname === '/api/organizations') {
    const data = await body(req);
    if (!data.name || !data.email || !data.password || !data.phone || !data.city || !data.license) return json(res, 400, { error: 'Please complete every required field.' });
    if (store.users.some(user => user.email?.toLowerCase() === String(data.email).toLowerCase())) return json(res, 409, { error: 'An account already exists for this email.' });
    if (String(data.password).length < 8) return json(res, 400, { error: 'Password must contain at least 8 characters.' });
    const owner = {
      id: id(), name: data.contactName || data.name, email: data.email.toLowerCase(), password: hash(data.password),
      phone: normalizePhone(data.phone), phoneVerified: false, role: 'organization', city: data.city,
      profileComplete: true, profileVerified: false, createdAt: now(), updatedAt: now()
    };
    const organization = {
      id: id(), ownerId: owner.id, name: data.name, type: data.type || 'Blood bank', phone: normalizePhone(data.phone),
      email: data.email.toLowerCase(), city: data.city, state: data.state || '', address: data.address || data.city,
      license: data.license, lat: Number(data.lat) || 12.9716, lng: Number(data.lng) || 77.5946,
      verified: false, emergencyAvailable: false, services: data.services || [], inventory: data.inventory || {}, createdAt: now()
    };
    owner.organizationId = organization.id;
    store.users.push(owner);
    store.organizations.push(organization);
    writeStore(store);
    return json(res, 201, { token: createToken(owner.id), user: privateUser(owner), organization });
  }

  if (req.method === 'GET' && url.pathname === '/api/stats') {
    return json(res, 200, {
      donors: store.users.filter(user => user.role === 'donor' && user.available).length,
      organizations: store.organizations.filter(org => org.verified !== false).length,
      openRequests: store.requests.filter(request => request.status === 'open' && new Date(request.neededBy) > new Date()).length,
      fulfilled: store.requests.filter(request => request.status === 'fulfilled').length
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/donors') {
    const blood = url.searchParams.get('blood');
    const lat = queryNumber(url, 'lat');
    const lng = queryNumber(url, 'lng');
    let donors = store.users.filter(user => user.role === 'donor' && user.available && (!blood || compatible[blood]?.includes(user.bloodGroup)));
    donors = donors.map(user => publicDonor(user, lat, lng)).sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
    return json(res, 200, donors);
  }

  if (req.method === 'GET' && url.pathname === '/api/organizations') {
    const lat = queryNumber(url, 'lat');
    const lng = queryNumber(url, 'lng');
    const blood = url.searchParams.get('blood');
    let rows = store.organizations.filter(org => org.verified !== false && (!blood || Number(org.inventory?.[blood] || 0) > 0));
    rows = rows.map(org => ({ ...org, distanceKm: Number.isFinite(lat) && Number.isFinite(lng) ? +distance(lat, lng, org.lat, org.lng).toFixed(1) : null }))
      .sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
    return json(res, 200, rows);
  }

  if (req.method === 'GET' && url.pathname === '/api/network/search') {
    const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
    const blood = url.searchParams.get('blood');
    const type = url.searchParams.get('type') || 'all';
    const verifiedOnly = url.searchParams.get('verified') === 'true';
    const availableOnly = url.searchParams.get('available') !== 'false';
    const maxDistance = Number(url.searchParams.get('distance') || 50);
    const lat = queryNumber(url, 'lat');
    const lng = queryNumber(url, 'lng');
    const include = value => !q || String(value || '').toLowerCase().includes(q);
    let donors = store.users.filter(user => user.role === 'donor' && (!availableOnly || user.available) && (!blood || compatible[blood]?.includes(user.bloodGroup)) && (!verifiedOnly || user.profileVerified));
    donors = donors.map(user => publicDonor(user, lat, lng)).filter(item => (item.distanceKm ?? 0) <= maxDistance && (include(item.name) || include(item.city) || include(item.bloodGroup)));
    let organizations = store.organizations.filter(org => org.verified !== false && (include(org.name) || include(org.type) || include(org.city)));
    organizations = organizations.map(org => ({
      id: org.id, name: org.name, type: org.type, city: org.city, state: org.state || '', address: org.address,
      verified: Boolean(org.verified), emergencyAvailable: Boolean(org.emergencyAvailable), services: org.services || [],
      distanceKm: Number.isFinite(lat) && Number.isFinite(lng) ? +distance(lat, lng, org.lat, org.lng).toFixed(1) : null,
      approximateLat: +Number(org.lat).toFixed(3), approximateLng: +Number(org.lng).toFixed(3)
    })).filter(item => (item.distanceKm ?? 0) <= maxDistance);
    const requests = store.requests.filter(request => request.status === 'open' && new Date(request.neededBy) > new Date() && (!blood || request.bloodGroup === blood) && (include(request.hospital) || include(request.city) || include(request.bloodGroup))).map(request => ({
      id: request.id, bloodGroup: request.bloodGroup, units: request.units, component: request.component,
      hospital: request.hospital, city: request.city, neededBy: request.neededBy,
      distanceKm: Number.isFinite(lat) && Number.isFinite(lng) ? +distance(lat, lng, request.lat, request.lng).toFixed(1) : null,
      approximateLat: +Number(request.lat).toFixed(2), approximateLng: +Number(request.lng).toFixed(2)
    })).filter(item => (item.distanceKm ?? 0) <= maxDistance);
    return json(res, 200, {
      donors: ['all','people'].includes(type) ? donors : [],
      organizations: ['all','organizations','hospitals','blood-banks'].includes(type) ? organizations.filter(org => type === 'all' || type === 'organizations' || (type === 'hospitals' ? /hospital|clinic/i.test(org.type) : /blood/i.test(org.type))) : [],
      requests: ['all','requests'].includes(type) ? requests : []
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/requests') {
    const mine = url.searchParams.get('mine') === 'true';
    const user = mine ? requireUser(req, res, store, 'Please sign in to see your requests.') : null;
    if (mine && !user) return;
    const rows = store.requests.filter(request => mine ? request.ownerId === user.id : request.status === 'open' && new Date(request.neededBy) > new Date()).sort((a, b) => new Date(a.neededBy) - new Date(b.neededBy));
    return json(res, 200, rows.map(request => mine ? request : ({ ...request, patientName:'Patient', phone:undefined, lat:undefined, lng:undefined })));
  }

  if (req.method === 'POST' && url.pathname === '/api/requests') {
    const user = requireUser(req, res, store, 'Please sign in before posting a request.');
    if (!user) return;
    const data = await body(req);
    if (!data.patientName || !data.bloodGroup || !data.units || !data.hospital || !data.phone) return json(res, 400, { error: 'Please complete the request details.' });
    const units = Number(data.units);
    if (!Number.isInteger(units) || units < 1 || units > 12) return json(res, 400, { error: 'Units must be between 1 and 12.' });
    const neededBy = data.neededBy ? new Date(data.neededBy) : new Date(Date.now() + 86400000);
    if (Number.isNaN(neededBy.getTime()) || neededBy.getTime() < Date.now() - 300000) return json(res, 400, { error: 'Choose a future date and time.' });
    const request = {
      id: id(), ownerId: user.id, patientName: String(data.patientName).trim(), bloodGroup: data.bloodGroup,
      units, component: data.component || 'Whole blood', hospital: String(data.hospital).trim(),
      city: String(data.city || user.city || '').trim(), phone: normalizePhone(data.phone), notes: String(data.notes || '').trim(),
      neededBy: neededBy.toISOString(), lat: Number(data.lat) || user.lat || 12.9716, lng: Number(data.lng) || user.lng || 77.5946,
      status: 'open', createdAt: now(), updatedAt: now()
    };
    store.requests.push(request);
    writeStore(store);
    return json(res, 201, request);
  }

  const requestMatch = url.pathname.match(/^\/api\/requests\/([^/]+)$/);
  if (req.method === 'PATCH' && requestMatch) {
    const user = requireUser(req, res, store);
    if (!user) return;
    const request = store.requests.find(item => item.id === requestMatch[1]);
    if (!request) return json(res, 404, { error: 'Request not found.' });
    if (request.ownerId !== user.id && user.role !== 'organization') return json(res, 403, { error: 'You cannot update this request.' });
    const data = await body(req);
    if (!['open','fulfilled','cancelled'].includes(data.status)) return json(res, 400, { error: 'Invalid request status.' });
    request.status = data.status;
    request.updatedAt = now();
    writeStore(store);
    return json(res, 200, request);
  }

  if (req.method === 'POST' && url.pathname === '/api/contact-requests') {
    const user = requireUser(req, res, store, 'Sign in before requesting a donation.');
    if (!user) return;
    if (!user.phoneVerified) return json(res, 403, { error:'Verify your phone before contacting a donor.' });
    const data = await body(req);
    if (!data.recipientId) return json(res, 400, { error: 'Choose a donor first.' });
    if (data.recipientId === user.id) return json(res, 400, { error: 'You cannot send a request to yourself.' });
    const duplicate = store.contactRequests.find(item => item.requesterId === user.id && item.recipientId === data.recipientId && item.status === 'pending');
    if (duplicate) return json(res, 409, { error: 'A request is already waiting for this donor.' });
    const contactRequest = {
      id: id(), requesterId: user.id, recipientId: data.recipientId, bloodRequestId: data.bloodRequestId || null,
      message: String(data.message || 'I would like to coordinate a blood donation.').slice(0, 500), status: 'pending',
      createdAt: now(), updatedAt: now()
    };
    store.contactRequests.push(contactRequest);
    writeStore(store);
    return json(res, 201, contactRequest);
  }

  if (req.method === 'GET' && url.pathname === '/api/contact-requests') {
    const user = requireUser(req, res, store);
    if (!user) return;
    const items = store.contactRequests.filter(item => item.requesterId === user.id || item.recipientId === user.id).map(item => {
      const incoming = item.recipientId === user.id;
      const other = store.users.find(candidate => candidate.id === (incoming ? item.requesterId : item.recipientId));
      return { ...item, direction: incoming ? 'incoming' : 'outgoing', otherName: other?.name || 'RedConnect member', otherPhone: item.status === 'approved' ? other?.phone : null };
    });
    return json(res, 200, items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
  }

  const contactMatch = url.pathname.match(/^\/api\/contact-requests\/([^/]+)$/);
  if (req.method === 'PATCH' && contactMatch) {
    const user = requireUser(req, res, store);
    if (!user) return;
    const item = store.contactRequests.find(candidate => candidate.id === contactMatch[1]);
    if (!item) return json(res, 404, { error: 'Contact request not found.' });
    if (item.recipientId !== user.id) return json(res, 403, { error: 'Only the receiving donor can respond.' });
    const data = await body(req);
    if (!['approved','declined'].includes(data.status)) return json(res, 400, { error: 'Choose approve or decline.' });
    item.status = data.status;
    item.updatedAt = now();
    writeStore(store);
    return json(res, 200, item);
  }

  if (req.method === 'GET' && url.pathname === '/api/donations') {
    const user = requireUser(req, res, store);
    if (!user) return;
    if (url.searchParams.get('pending') === 'true') {
      if (user.role !== 'organization') return json(res, 403, { error:'Only organizations can verify donations.' });
      const rows = store.donations.filter(item => item.organizationId === user.organizationId && item.verificationStatus === 'pending').map(item => ({
        ...item,
        donorName:store.users.find(candidate => candidate.id === item.userId)?.name || 'RedConnect donor'
      }));
      return json(res, 200, rows);
    }
    return json(res, 200, store.donations.filter(item => item.userId === user.id).sort((a, b) => new Date(b.donatedAt) - new Date(a.donatedAt)));
  }

  if (req.method === 'POST' && url.pathname === '/api/donations') {
    const user = requireUser(req, res, store);
    if (!user) return;
    const data = await body(req);
    if (!data.donatedAt || !data.component) return json(res, 400, { error: 'Add the donation date and component.' });
    const donation = {
      id: id(), userId: user.id, donatedAt: new Date(data.donatedAt).toISOString(), organizationId: data.organizationId || null,
      component: data.component, verificationStatus: 'pending', createdAt: now()
    };
    store.donations.push(donation);
    writeStore(store);
    return json(res, 201, donation);
  }

  const donationMatch = url.pathname.match(/^\/api\/donations\/([^/]+)$/);
  if (req.method === 'PATCH' && donationMatch) {
    const user = requireUser(req, res, store);
    if (!user) return;
    if (user.role !== 'organization') return json(res, 403, { error:'Only organizations can verify donations.' });
    const donation = store.donations.find(item => item.id === donationMatch[1]);
    if (!donation) return json(res, 404, { error:'Donation record not found.' });
    if (!donation.organizationId || donation.organizationId !== user.organizationId) return json(res, 403, { error:'This donation is assigned to another organization.' });
    const organization = store.organizations.find(item => item.id === user.organizationId);
    if (!organization?.verified) return json(res, 403, { error:'Your organization must be verified first.' });
    if (donation.verificationStatus !== 'pending') return json(res, 409, { error:'This record already has a final verification status.' });
    const data = await body(req);
    if (!['verified','rejected'].includes(data.verificationStatus)) return json(res, 400, { error:'Choose verified or rejected.' });
    donation.verificationStatus = data.verificationStatus;
    donation.verifiedBy = user.id;
    donation.verifiedAt = now();
    if (data.verificationStatus === 'verified') {
      const donor = store.users.find(item => item.id === donation.userId);
      if (donor) {
        donor.lastDonatedAt = donation.donatedAt.slice(0,10);
        donor.donationCount = Number(donor.donationCount || 0) + 1;
        donor.nextEligibleDate = new Date(new Date(donation.donatedAt).getTime() + 90 * 86400000).toISOString().slice(0,10);
      }
    }
    writeStore(store);
    return json(res, 200, donation);
  }

  return json(res, 404, { error: 'Not found' });
}

const mime = {
  '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'application/javascript; charset=utf-8',
  '.mjs':'application/javascript; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml'
};

const app = async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    let file = path.join(PUBLIC, decodeURIComponent(url.pathname));
    if (url.pathname === '/') file = path.join(PUBLIC, 'index.html');
    if (url.pathname === '/favicon.ico') file = path.join(PUBLIC, 'logo.svg');
    if (file.startsWith(PUBLIC) && fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) file = path.join(PUBLIC, 'index.html');
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (error) {
    console.error(error);
    json(res, 500, { error: 'Something went wrong. Please try again.' });
  }
};

if (require.main === module) {
  http.createServer(app).listen(PORT, () => console.log(`RedConnect is running at http://localhost:${PORT}`));
}

module.exports = app;
