(function () {
  const config = window.RED_CONNECT_CONFIG || {};
  const configured = /^https:\/\/.+\.supabase\.co$/.test(config.supabaseUrl || '') && !String(config.supabasePublishableKey || '').startsWith('YOUR_');
  if (!configured || !window.supabase) {
    window.RedConnectDB = { enabled: () => false };
    return;
  }

  const client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  const compatibility = { 'O-':['O-'], 'O+':['O-','O+'], 'A-':['O-','A-'], 'A+':['O-','O+','A-','A+'], 'B-':['O-','B-'], 'B+':['O-','O+','B-','B+'], 'AB-':['O-','A-','B-','AB-'], 'AB+':['O-','O+','A-','A+','B-','B+','AB-','AB+'] };
  const distance = (a,b,c,d) => { const r=6371,p=Math.PI/180,x=Math.sin((c-a)*p/2)**2+Math.cos(a*p)*Math.cos(c*p)*Math.sin((d-b)*p/2)**2;return +(2*r*Math.asin(Math.sqrt(x))).toFixed(1); };
  const camel = row => row && ({ ...row, bloodGroup:row.blood_group, ownerId:row.owner_id, organizationId:row.organization_id, patientName:row.patient_name, neededBy:row.needed_by, createdAt:row.created_at, updatedAt:row.updated_at });
  const clean = row => { const value=camel(row); if(!value)return value; ['blood_group','owner_id','organization_id','patient_name','needed_by','created_at','updated_at'].forEach(k=>delete value[k]); return value; };
  const fail = error => { if(error) throw new Error(error.message || 'Database request failed.'); };
  const currentUser = async () => { const {data,error}=await client.auth.getUser();fail(error);if(!data.user)throw new Error('Please sign in again.');return data.user; };
  const profile = async id => { const {data,error}=await client.from('profiles').select('*').eq('id',id).single();fail(error);return clean(data); };

  async function request(path, options={}) {
    const url=new URL(path,location.origin), method=(options.method||'GET').toUpperCase(), payload=options.body?JSON.parse(options.body):{};
    if(path==='/api/stats') {
      const {data:authData}=await client.auth.getUser();
      const [d,o,r,f]=await Promise.all([
        authData.user?client.from('profiles').select('id',{count:'exact',head:true}).eq('role','donor').eq('available',true):Promise.resolve({count:0,error:null}),
        client.from('organizations').select('id',{count:'exact',head:true}).eq('verified',true),
        client.from('blood_requests').select('id',{count:'exact',head:true}).eq('status','open').gt('needed_by',new Date().toISOString()),
        client.from('blood_requests').select('id',{count:'exact',head:true}).eq('status','fulfilled')
      ]); [d,o,r,f].forEach(x=>fail(x.error)); return {donors:d.count||0,organizations:o.count||0,openRequests:r.count||0,fulfilled:f.count||0};
    }
    if(path==='/api/me'&&method==='GET') return profile((await currentUser()).id);
    if(path==='/api/me'&&method==='PATCH') { const user=await currentUser();const update={};['available','phone','city','lat','lng'].forEach(k=>{if(payload[k]!==undefined)update[k]=payload[k]});const {data,error}=await client.from('profiles').update(update).eq('id',user.id).select().single();fail(error);return clean(data); }
    if(url.pathname==='/api/register') {
      const metadata={name:payload.name,phone:payload.phone,blood_group:payload.bloodGroup,city:payload.city,lat:Number(payload.lat)||null,lng:Number(payload.lng)||null,role:payload.role==='patient'?'patient':'donor'};
      const {data,error}=await client.auth.signUp({email:payload.email,password:payload.password,options:{data:metadata}});fail(error);return {token:data.session?.access_token||'',user:data.user?{id:data.user.id,email:data.user.email,...metadata,bloodGroup:metadata.blood_group}:null,needsConfirmation:!data.session};
    }
    if(url.pathname==='/api/organizations'&&method==='POST') {
      const metadata={name:payload.contactName||payload.name,phone:payload.phone,city:payload.city,role:'organization',organization_name:payload.name,organization_type:payload.type,organization_license:payload.license,organization_address:payload.address,lat:Number(payload.lat)||null,lng:Number(payload.lng)||null};
      const {data,error}=await client.auth.signUp({email:payload.email,password:payload.password,options:{data:metadata}});fail(error);return {token:data.session?.access_token||'',user:data.user?{id:data.user.id,email:data.user.email,...metadata}:null,needsConfirmation:!data.session};
    }
    if(url.pathname==='/api/login') { const {data,error}=await client.auth.signInWithPassword({email:payload.email,password:payload.password});fail(error);return {token:data.session.access_token,user:await profile(data.user.id)}; }
    if(url.pathname==='/api/requests'&&method==='GET') { let query=client.from('blood_requests').select('*').order('needed_by');if(url.searchParams.get('mine')==='true')query=query.eq('owner_id',(await currentUser()).id);else query=query.eq('status','open').gt('needed_by',new Date().toISOString());const {data,error}=await query;fail(error);return (data||[]).map(clean); }
    if(url.pathname==='/api/requests'&&method==='POST') { const user=await currentUser();const row={owner_id:user.id,patient_name:payload.patientName,blood_group:payload.bloodGroup,units:Number(payload.units),component:payload.component,hospital:payload.hospital,city:payload.city,phone:payload.phone,notes:payload.notes||'',needed_by:new Date(payload.neededBy).toISOString(),lat:Number(payload.lat)||null,lng:Number(payload.lng)||null};const {data,error}=await client.from('blood_requests').insert(row).select().single();fail(error);return clean(data); }
    if(/^\/api\/requests\/[^/]+$/.test(url.pathname)&&method==='PATCH') { const id=url.pathname.split('/').pop();const {data,error}=await client.from('blood_requests').update({status:payload.status}).eq('id',id).select().single();fail(error);return clean(data); }
    if(url.pathname==='/api/donors') { const blood=url.searchParams.get('blood'),lat=Number(url.searchParams.get('lat')),lng=Number(url.searchParams.get('lng'));let query=client.from('profiles').select('id,name,phone,blood_group,city,lat,lng,available').eq('role','donor').eq('available',true);if(blood)query=query.in('blood_group',compatibility[blood]);const {data,error}=await query;fail(error);return (data||[]).map(clean).map(x=>Number.isFinite(lat)&&Number.isFinite(lng)&&x.lat&&x.lng?{...x,distanceKm:distance(lat,lng,x.lat,x.lng)}:x).sort((a,b)=>(a.distanceKm??999)-(b.distanceKm??999)); }
    if(url.pathname==='/api/organizations'&&method==='GET') { const blood=url.searchParams.get('blood'),lat=Number(url.searchParams.get('lat')),lng=Number(url.searchParams.get('lng'));const {data,error}=await client.from('organizations').select('*, organization_inventory(blood_group,units)').eq('verified',true);fail(error);return (data||[]).map(row=>{const inventory=Object.fromEntries((row.organization_inventory||[]).map(x=>[x.blood_group,x.units]));const item={...row,inventory};delete item.organization_inventory;return Number.isFinite(lat)&&Number.isFinite(lng)&&item.lat&&item.lng?{...item,distanceKm:distance(lat,lng,item.lat,item.lng)}:item}).filter(x=>!blood||Number(x.inventory[blood]||0)>0).sort((a,b)=>(a.distanceKm??999)-(b.distanceKm??999)); }
    throw new Error('Unsupported database request.');
  }
  client.channel('redconnect-emergency-requests').on('postgres_changes',{event:'*',schema:'public',table:'blood_requests'},()=>window.dispatchEvent(new CustomEvent('redconnect:requests-changed'))).subscribe();
  window.RedConnectDB={enabled:()=>true,request,signOut:()=>client.auth.signOut(),client};
})();
