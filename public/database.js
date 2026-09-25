(function () {
  const config = window.RED_CONNECT_CONFIG || {};
  const ADMIN_EMAIL = 'shanmukhamarthi@gmail.com';
  const ADMIN_PASSWORD = 'shanmukh2007';
  const configured = !config.forceLocalDatabase && /^https:\/\/.+\.supabase\.co$/.test(config.supabaseUrl || '') && !String(config.supabasePublishableKey || '').startsWith('YOUR_');
  if (!configured || !window.supabase) {
    window.RedConnectDB = { enabled: () => false };
    return;
  }

  const client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:true }
  });
  const compatibility = {
    'O-':['O-'], 'O+':['O-','O+'], 'A-':['O-','A-'], 'A+':['O-','O+','A-','A+'],
    'B-':['O-','B-'], 'B+':['O-','O+','B-','B+'], 'AB-':['O-','A-','B-','AB-'],
    'AB+':['O-','O+','A-','A+','B-','B+','AB-','AB+']
  };
  const distance = (a, b, c, d) => {
    const radius = 6371;
    const p = Math.PI / 180;
    const x = Math.sin((c-a)*p/2) ** 2 + Math.cos(a*p) * Math.cos(c*p) * Math.sin((d-b)*p/2) ** 2;
    return +(2 * radius * Math.asin(Math.sqrt(x))).toFixed(1);
  };
  const fail = error => {
    if (error) {
      if (error.code === 'PGRST116' ||
          error.code === '42501' ||
          String(error.message || '').includes('Cannot coerce') ||
          String(error.message || '').includes('multiple (or no) rows') ||
          String(error.message || '').includes('permission denied for table rc_user_profiles')) {
        return;
      }
      throw new Error(error.message || 'Database request failed.');
    }
  };
  const queryNumber = (url, name) => url.searchParams.has(name) ? Number(url.searchParams.get(name)) : Number.NaN;
  const currentAuthUser = async () => {
    const localToken = typeof localStorage !== 'undefined' ? localStorage.getItem('redconnect_token') : '';
    if (localToken === 'admin-local-session-token') {
      return { id: 'admin-local-id', email: ADMIN_EMAIL };
    }
    const { data, error } = await client.auth.getUser();
    fail(error);
    if (!data.user) throw new Error('Please sign in again.');
    return data.user;
  };
  const camel = row => {
    if (!row) return row;
    const output = {};
    Object.entries(row).forEach(([key, value]) => {
      const camelKey = key.replace(/_([a-z])/g, (_, character) => character.toUpperCase());
      output[camelKey] = value;
    });
    if (output.userId && !output.id) output.id = output.userId;
    if (output.donationId && !output.id) output.id = output.donationId;
    return output;
  };
  const publicRequest = row => {
    const item = camel(row);
    delete item.phone;
    delete item.lat;
    delete item.lng;
    delete item.ownerId;
    return item;
  };
  const getAdminProfile = () => {
    try {
      const stored = localStorage.getItem('redconnect_admin_profile');
      if (stored) return JSON.parse(stored);
    } catch {}
    return {
      id: 'admin-local-id',
      email: ADMIN_EMAIL,
      name: 'Admin',
      role: 'admin',
      phone: '',
      phoneVerified: true,
      bloodGroup: '',
      city: '',
      state: '',
      country: 'India',
      profileComplete: true,
      profileVerified: true,
      available: false,
      availabilityStatus: 'unavailable',
      donationCount: 0
    };
  };
  const saveAdminProfile = updates => {
    const current = getAdminProfile();
    const updated = { ...current, ...updates };
    try {
      localStorage.setItem('redconnect_admin_profile', JSON.stringify(updated));
    } catch {}
    return updated;
  };
  const profile = async userId => {
    if (userId === 'admin-local-id') {
      return getAdminProfile();
    }
    const [profileResult, locationResult, availabilityResult] = await Promise.all([
      client.from('rc_user_profiles').select('*').eq('user_id', userId).limit(1),
      client.from('rc_user_locations').select('*').eq('user_id', userId).limit(1),
      client.from('rc_donor_availability').select('*').eq('user_id', userId).limit(1)
    ]);
    fail(profileResult.error);
    fail(locationResult.error);
    fail(availabilityResult.error);
    const profileRow = (profileResult.data && profileResult.data[0]) || {};
    const locationRow = (locationResult.data && locationResult.data[0]) || {};
    const availabilityRow = (availabilityResult.data && availabilityResult.data[0]) || {};
    const item = camel(profileRow) || {};
    const location = camel(locationRow) || {};
    const availability = camel(availabilityRow) || {};
    return {
      ...item,
      id:userId,
      name:item.fullName || item.name || '',
      phone:item.phoneNumber || item.phone || '',
      bloodGroup:item.bloodGroup || '',
      city:item.city || location.city || '',
      state:item.state || location.state || '',
      country:item.country || location.country || 'India',
      role:item.role || 'donor',
      profileComplete:Boolean(item.profileComplete),
      profileVerified:Boolean(item.profileVerified),
      lat:location.latitude,
      lng:location.longitude,
      available:Boolean(availability.isAvailable),
      availabilityStatus:availability.status || item.availabilityStatus || 'unavailable',
      donationCount:Number(item.donationCount || 0)
    };
  };

  async function request(path, options = {}) {
    const url = new URL(path, location.origin);
    const method = (options.method || 'GET').toUpperCase();
    const payload = options.body ? JSON.parse(options.body) : {};

    if (url.pathname === '/api/auth/phone/start' && method === 'POST') {
      const phone = String(payload.phone || '').replace(/[\s()-]/g, '');
      const { error } = await client.auth.signInWithOtp({ phone, options:{ shouldCreateUser:true } });
      fail(error);
      return { phone, sent:true, expiresInSeconds:600 };
    }

    if (url.pathname === '/api/auth/phone/verify' && method === 'POST') {
      const phone = String(payload.phone || '').replace(/[\s()-]/g, '');
      const { data, error } = await client.auth.verifyOtp({ phone, token:String(payload.otp || ''), type:'sms' });
      fail(error);
      const userProfile = await profile(data.user.id);
      return { token:data.session?.access_token || '', user:userProfile, needsProfile:!userProfile.profileComplete };
    }

    if (url.pathname === '/api/login' && method === 'POST') {
      // TEMPORARY ADMIN LOGIN — bypasses Supabase entirely — REMOVE BEFORE PRODUCTION
      const normalizedEmail = String(payload.email || '').trim().toLowerCase();
      const normalizedPassword = String(payload.password || '').trim();
      if ((normalizedEmail === ADMIN_EMAIL.toLowerCase() || payload.email === ADMIN_EMAIL) &&
          (normalizedPassword === ADMIN_PASSWORD || normalizedPassword === 'shanmukha2007' || payload.password === ADMIN_PASSWORD)) {
        return {
          token: 'admin-local-session-token',
          user: getAdminProfile()
        };
      }

      const { data, error } = await client.auth.signInWithPassword({ email:payload.email, password:payload.password });
      fail(error);
      const userProfile = await profile(data.user.id);
      if (userProfile && !userProfile.email) userProfile.email = data.user.email || payload.email;
      return { token:data.session.access_token, user:userProfile };
    }

    if (url.pathname === '/api/password-reset' && method === 'POST') {
      const { error } = await client.auth.resetPasswordForEmail(payload.email, { redirectTo:`${location.origin}/` });
      fail(error);
      return { message:'If that account exists, reset instructions have been sent.' };
    }

    if (url.pathname === '/api/password-update' && method === 'POST') {
      const { error } = await client.auth.updateUser({ password:payload.password });
      fail(error);
      return { message:'Your password has been updated.' };
    }

    if (url.pathname === '/api/me' && method === 'GET') {
      const user = await currentAuthUser();
      if (user.id === 'admin-local-id') return getAdminProfile();
      const userProfile = await profile(user.id);
      if (userProfile && !userProfile.email) userProfile.email = user.email;
      return userProfile;
    }

    if (url.pathname === '/api/me' && method === 'PATCH') {
      const user = await currentAuthUser();
      if (user.id === 'admin-local-id') {
        const adminUpdates = {};
        if (payload.name !== undefined) adminUpdates.name = payload.name;
        if (payload.phone !== undefined) adminUpdates.phone = payload.phone;
        if (payload.bloodGroup !== undefined) adminUpdates.bloodGroup = payload.bloodGroup;
        if (payload.city !== undefined) adminUpdates.city = payload.city;
        if (payload.state !== undefined) adminUpdates.state = payload.state;
        if (payload.country !== undefined) adminUpdates.country = payload.country;
        if (payload.role !== undefined) adminUpdates.role = payload.role;
        if (typeof payload.available === 'boolean') {
          adminUpdates.available = payload.available;
          adminUpdates.availabilityStatus = payload.available ? 'available' : 'unavailable';
        }
        if (Number.isFinite(Number(payload.lat))) adminUpdates.lat = Number(payload.lat);
        if (Number.isFinite(Number(payload.lng))) adminUpdates.lng = Number(payload.lng);
        adminUpdates.profileComplete = true;
        return saveAdminProfile(adminUpdates);
      }
      const profileUpdate = { updated_at:new Date().toISOString() };
      const profileMap = {
        name:'full_name', bloodGroup:'blood_group', dateOfBirth:'date_of_birth', gender:'gender', city:'city',
        state:'state', country:'country', lastDonatedAt:'last_donated_at', availabilityStatus:'availability_status'
      };
      Object.entries(profileMap).forEach(([source, target]) => {
        if (payload[source] !== undefined && payload[source] !== '') profileUpdate[target] = payload[source];
      });
      if (['name','bloodGroup','city','country'].some(key => payload[key] !== undefined)) {
        const existing = await profile(user.id);
        profileUpdate.profile_complete = Boolean(
          String(payload.name ?? existing.name ?? '').trim() &&
          (payload.bloodGroup ?? existing.bloodGroup) &&
          String(payload.city ?? existing.city ?? '').trim() &&
          String(payload.country ?? existing.country ?? '').trim()
        );
      }
      if (payload.lastDonatedAt) {
        const eligible = new Date(payload.lastDonatedAt);
        eligible.setDate(eligible.getDate() + 90);
        profileUpdate.next_eligible_date = eligible.toISOString().slice(0,10);
      }
      const profileResult = await client.from('rc_user_profiles').update(profileUpdate).eq('user_id', user.id);
      fail(profileResult.error);
      if (Number.isFinite(Number(payload.lat)) && Number.isFinite(Number(payload.lng))) {
        const locationResult = await client.from('rc_user_locations').upsert({
          user_id:user.id, latitude:Number(payload.lat), longitude:Number(payload.lng), city:payload.city || null,
          state:payload.state || null, country:payload.country || null, updated_at:new Date().toISOString()
        }, { onConflict: 'user_id' });
        if (locationResult.error && !String(locationResult.error.message || '').includes('foreign key')) {
          fail(locationResult.error);
        }
      }
      if (typeof payload.available === 'boolean') {
        const availabilityResult = await client.from('rc_donor_availability').upsert({
          user_id:user.id, is_available:payload.available, status:payload.available ? 'available' : 'unavailable', updated_at:new Date().toISOString()
        }, { onConflict: 'user_id' });
        if (availabilityResult.error && !String(availabilityResult.error.message || '').includes('foreign key')) {
          fail(availabilityResult.error);
        }
      }
      return profile(user.id);
    }

    if (url.pathname === '/api/register' && method === 'POST') {
      const metadata = {
        name:payload.name, phone:payload.phone, blood_group:payload.bloodGroup, city:payload.city,
        state:payload.state, country:payload.country || 'India', role:payload.role === 'patient' ? 'patient' : 'donor'
      };
      const { data, error } = await client.auth.signUp({ email:payload.email, password:payload.password, options:{ data:metadata } });
      fail(error);
      return { token:data.session?.access_token || '', user:data.user ? { id:data.user.id, email:data.user.email, ...payload } : null, needsConfirmation:!data.session };
    }

    if (url.pathname === '/api/organizations' && method === 'POST') {
      const metadata = {
        name:payload.contactName || payload.name, phone:payload.phone, city:payload.city, state:payload.state,
        role:'organization', organization_name:payload.name, organization_type:payload.type,
        organization_license:payload.license, organization_address:payload.address,
        lat:Number(payload.lat) || null, lng:Number(payload.lng) || null
      };
      const { data, error } = await client.auth.signUp({ email:payload.email, password:payload.password, options:{ data:metadata } });
      fail(error);
      return { token:data.session?.access_token || '', user:data.user ? { id:data.user.id, email:data.user.email, ...metadata } : null, needsConfirmation:!data.session };
    }

    if (url.pathname === '/api/stats') {
      const [donors, organizations, requests, fulfilled] = await Promise.all([
        client.from('rc_donor_directory').select('user_id', { count:'exact', head:true }).eq('availability_status','available'),
        client.from('rc_organizations').select('id', { count:'exact', head:true }).eq('verified',true),
        client.from('rc_blood_request_directory').select('request_id', { count:'exact', head:true }).gt('needed_by',new Date().toISOString()),
        Promise.resolve({ count:0, error:null })
      ]);
      [donors, organizations, requests, fulfilled].forEach(result => fail(result.error));
      return { donors:donors.count || 0, organizations:organizations.count || 0, openRequests:requests.count || 0, fulfilled:fulfilled.count || 0 };
    }

    if (url.pathname === '/api/donors') {
      const blood = url.searchParams.get('blood');
      const lat = queryNumber(url, 'lat');
      const lng = queryNumber(url, 'lng');
      let query = client.from('rc_donor_directory').select('*').eq('availability_status','available');
      if (blood) query = query.in('blood_group', compatibility[blood]);
      const { data, error } = await query;
      fail(error);
      return (data || []).map(camel).map(item => ({
        ...item,
        id:item.userId,
        name:item.displayName,
        bloodGroup:item.bloodGroup,
        approximateLat:item.approximateLatitude,
        approximateLng:item.approximateLongitude,
        distanceKm:Number.isFinite(lat) && Number.isFinite(lng) && item.approximateLatitude && item.approximateLongitude ? distance(lat,lng,item.approximateLatitude,item.approximateLongitude) : null
      })).sort((a,b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
    }

    if (url.pathname === '/api/organizations' && method === 'GET') {
      const blood = url.searchParams.get('blood');
      const lat = queryNumber(url, 'lat');
      const lng = queryNumber(url, 'lng');
      const { data, error } = await client.from('rc_organizations').select('*, rc_organization_inventory(blood_group,units), rc_organization_services(service,emergency_available)').eq('verified',true);
      fail(error);
      return (data || []).map(row => {
        const item = camel(row);
        item.inventory = Object.fromEntries((row.rc_organization_inventory || []).map(entry => [entry.blood_group,entry.units]));
        item.services = (row.rc_organization_services || []).map(entry => entry.service);
        delete item.rcOrganizationInventory;
        delete item.rcOrganizationServices;
        item.distanceKm = Number.isFinite(lat) && Number.isFinite(lng) && item.lat && item.lng ? distance(lat,lng,item.lat,item.lng) : null;
        return item;
      }).filter(item => !blood || Number(item.inventory[blood] || 0) > 0).sort((a,b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
    }

    if (url.pathname === '/api/network/search') {
      const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
      const blood = url.searchParams.get('blood');
      const type = url.searchParams.get('type') || 'all';
      const verifiedOnly = url.searchParams.get('verified') === 'true';
      const maxDistance = Number(url.searchParams.get('distance') || 50);
      const lat = queryNumber(url, 'lat');
      const lng = queryNumber(url, 'lng');
      const [donorResult, organizationResult, requestResult] = await Promise.all([
        ['all','people'].includes(type) ? requestDonorDirectory(blood) : Promise.resolve([]),
        ['all','organizations','hospitals','blood-banks'].includes(type) ? requestOrganizations() : Promise.resolve([]),
        ['all','requests'].includes(type) ? requestOpenRequests() : Promise.resolve([])
      ]);
      const include = value => !q || String(value || '').toLowerCase().includes(q);
      const donors = donorResult.map(item => ({ ...item, distanceKm:item.approximateLatitude && Number.isFinite(lat) ? distance(lat,lng,item.approximateLatitude,item.approximateLongitude) : null }))
        .filter(item => (!verifiedOnly || item.profileVerified) && (item.distanceKm ?? 0) <= maxDistance && (include(item.displayName) || include(item.city) || include(item.bloodGroup)))
        .map(item => ({ ...item, id:item.userId, name:item.displayName, approximateLat:item.approximateLatitude, approximateLng:item.approximateLongitude }));
      const organizations = organizationResult.map(item => ({ ...item, distanceKm:item.lat && Number.isFinite(lat) ? distance(lat,lng,item.lat,item.lng) : null, approximateLat:item.lat, approximateLng:item.lng }))
        .filter(item => (item.distanceKm ?? 0) <= maxDistance && (include(item.name) || include(item.type) || include(item.city)) && (type === 'all' || type === 'organizations' || (type === 'hospitals' ? /hospital|clinic/i.test(item.type) : /blood/i.test(item.type))));
      const requests = requestResult.map(item => {
        const requestLat = item.approximateLat ?? item.approximateLatitude;
        const requestLng = item.approximateLng ?? item.approximateLongitude;
        return {
          ...item,
          distanceKm:requestLat && Number.isFinite(lat) ? distance(lat,lng,requestLat,requestLng) : null,
          approximateLat:requestLat ?? null,
          approximateLng:requestLng ?? null
        };
      })
        .filter(item => (!blood || item.bloodGroup === blood) && (item.distanceKm ?? 0) <= maxDistance && (include(item.hospital) || include(item.city) || include(item.bloodGroup)))
        .map(publicRequest);
      return { donors, organizations, requests };
    }

    if (url.pathname === '/api/requests' && method === 'GET') {
      const mine = url.searchParams.get('mine') === 'true';
      let query;
      if (mine) {
        const user = await currentAuthUser();
        if (user.id === 'admin-local-id') return [];
        query = client.from('rc_blood_requests').select('*').eq('owner_id',user.id).order('needed_by');
      }
      else query = client.from('rc_blood_request_directory').select('*').gt('needed_by',new Date().toISOString()).order('needed_by');
      const { data, error } = await query;
      fail(error);
      return (data || []).map(item => {
        if (mine) return camel(item);
        const safe = camel(item);
        return { ...safe, id:safe.requestId, patientName:'Patient', status:'open', approximateLat:safe.approximateLatitude, approximateLng:safe.approximateLongitude };
      });
    }

    if (url.pathname === '/api/requests' && method === 'POST') {
      const user = await currentAuthUser();
      const row = {
        owner_id:user.id, patient_name:payload.patientName, blood_group:payload.bloodGroup, units:Number(payload.units),
        component:payload.component, hospital:payload.hospital, city:payload.city, phone:payload.phone,
        notes:payload.notes || '', needed_by:new Date(payload.neededBy).toISOString(),
        lat:Number(payload.lat) || null, lng:Number(payload.lng) || null
      };
      const { data, error } = await client.from('rc_blood_requests').insert(row).select().single();
      fail(error);
      return camel(data);
    }

    if (/^\/api\/requests\/[^/]+$/.test(url.pathname) && method === 'PATCH') {
      const requestId = url.pathname.split('/').pop();
      const { data, error } = await client.from('rc_blood_requests').update({ status:payload.status, updated_at:new Date().toISOString() }).eq('id',requestId).select().single();
      fail(error);
      return camel(data);
    }

    if (url.pathname === '/api/contact-requests' && method === 'POST') {
      const user = await currentAuthUser();
      const { data, error } = await client.from('rc_contact_requests').insert({
        requester_id:user.id, recipient_id:payload.recipientId, blood_request_id:payload.bloodRequestId || null,
        message:payload.message || 'I would like to coordinate a blood donation.'
      }).select().single();
      fail(error);
      return camel(data);
    }

    if (url.pathname === '/api/contact-requests' && method === 'GET') {
      const user = await currentAuthUser();
      if (user.id === 'admin-local-id') return [];
      const { data, error } = await client.from('rc_contact_requests').select('*').or(`requester_id.eq.${user.id},recipient_id.eq.${user.id}`).order('created_at',{ascending:false});
      fail(error);
      const ids = [...new Set((data || []).map(item => item.requester_id === user.id ? item.recipient_id : item.requester_id))];
      let names = {};
      if (ids.length) {
        const directoryResult = await client.from('rc_donor_directory').select('user_id,display_name').in('user_id',ids);
        fail(directoryResult.error);
        names = Object.fromEntries((directoryResult.data || []).map(item => [item.user_id,item.display_name]));
      }
      return (data || []).map(row => {
        const item = camel(row);
        const incoming = item.recipientId === user.id;
        const otherId = incoming ? item.requesterId : item.recipientId;
        return { ...item, direction:incoming ? 'incoming' : 'outgoing', otherName:names[otherId] || 'RedConnect member', otherPhone:item.sharedPhone || null };
      });
    }

    if (/^\/api\/contact-requests\/[^/]+$/.test(url.pathname) && method === 'PATCH') {
      const requestId = url.pathname.split('/').pop();
      const { data, error } = await client.from('rc_contact_requests').update({ status:payload.status, updated_at:new Date().toISOString() }).eq('id',requestId).select().single();
      fail(error);
      return camel(data);
    }

    if (url.pathname === '/api/donations' && method === 'GET') {
      const user = await currentAuthUser();
      if (user.id === 'admin-local-id') return [];
      let query = client.from('rc_donation_history').select('*').order('donated_at',{ascending:false});
      if (url.searchParams.get('pending') === 'true') {
        const organizationResult = await client.from('rc_organizations').select('id').eq('owner_id',user.id).maybeSingle();
        fail(organizationResult.error);
        if (!organizationResult.data?.id) return [];
        query = query.eq('organization_id',organizationResult.data.id).eq('verification_status','pending');
      } else query = query.eq('user_id',user.id);
      const { data, error } = await query;
      fail(error);
      return (data || []).map(camel);
    }

    if (url.pathname === '/api/donations' && method === 'POST') {
      const user = await currentAuthUser();
      const { data, error } = await client.from('rc_donation_history').insert({
        user_id:user.id, donated_at:new Date(payload.donatedAt).toISOString(),
        organization_id:payload.organizationId || null, component:payload.component, verification_status:'pending'
      }).select().single();
      fail(error);
      return camel(data);
    }

    if (/^\/api\/donations\/[^/]+$/.test(url.pathname) && method === 'PATCH') {
      const user = await currentAuthUser();
      const donationId = url.pathname.split('/').pop();
      const { data, error } = await client.from('rc_donation_history').update({
        verification_status:payload.verificationStatus,
        verified_by:user.id
      }).eq('donation_id',donationId).select().single();
      fail(error);
      return camel(data);
    }

    throw new Error('Unsupported database request.');
  }

  async function requestDonorDirectory(blood) {
    let query = client.from('rc_donor_directory').select('*').eq('availability_status','available');
    if (blood) query = query.in('blood_group',compatibility[blood]);
    const { data, error } = await query;
    fail(error);
    return (data || []).map(camel);
  }
  async function requestOrganizations() {
    const { data, error } = await client.from('rc_organizations').select('id,name,type,city,address,verified,emergency_available,lat,lng').eq('verified',true);
    fail(error);
    return (data || []).map(camel);
  }
  async function requestOpenRequests() {
    const { data, error } = await client.from('rc_blood_request_directory').select('*').gt('needed_by',new Date().toISOString());
    fail(error);
    return (data || []).map(row => {
      const item = camel(row);
      return { ...item, id:item.requestId, status:'open', approximateLat:item.approximateLatitude, approximateLng:item.approximateLongitude };
    });
  }

  client.channel('redconnect-network')
    .on('postgres_changes',{ event:'*', schema:'public', table:'rc_blood_request_directory' },() => window.dispatchEvent(new CustomEvent('redconnect:requests-changed')))
    .on('postgres_changes',{ event:'*', schema:'public', table:'rc_contact_requests' },() => window.dispatchEvent(new CustomEvent('redconnect:contacts-changed')))
    .subscribe();

  client.auth.onAuthStateChange(event => {
    if (event === 'PASSWORD_RECOVERY') window.dispatchEvent(new CustomEvent('redconnect:password-recovery'));
  });

  window.RedConnectDB = { enabled:() => true, request, signOut:() => client.auth.signOut(), client };
})();
