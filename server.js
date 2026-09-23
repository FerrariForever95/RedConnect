const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8080);
const PUBLIC = path.join(__dirname, 'public');
const DATA = path.join(__dirname, 'data', 'store.json');
const SESSION_SECRET = process.env.SESSION_SECRET || 'redconnect-local-development-secret-change-in-production';

const readStore = () => JSON.parse(fs.readFileSync(DATA, 'utf8'));
const writeStore = (data) => fs.writeFileSync(DATA, JSON.stringify(data, null, 2));
const id = () => crypto.randomUUID();
const hash = (password, salt = crypto.randomBytes(16).toString('hex')) => `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
const verify = (password, saved = '') => { const [salt, key] = saved.split(':'); if (!salt || !key) return false; return crypto.timingSafeEqual(Buffer.from(key, 'hex'), crypto.scryptSync(password, salt, 64)); };
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(body)); };
const body = (req) => new Promise((resolve, reject) => { let raw = ''; req.on('data', c => { raw += c; if (raw.length > 1e6) req.destroy(); }); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } }); });
const sign = value => crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
const createToken = userId => { const payload = Buffer.from(JSON.stringify({ userId, exp: Date.now() + 7 * 86400000 })).toString('base64url'); return `${payload}.${sign(payload)}`; };
const auth = (req, store) => {
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const [payload, signature] = token.split('.');
    const expected = payload ? sign(payload) : '';
    if (!payload || !signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (session.exp < Date.now()) return null;
    return store.users.find(u => u.id === session.userId) || null;
  } catch { return null; }
};
const safeUser = ({ password, ...user }) => user;
const distance = (a, b, c, d) => { const r = 6371, p = Math.PI / 180; const x = Math.sin((c-a)*p/2)**2 + Math.cos(a*p)*Math.cos(c*p)*Math.sin((d-b)*p/2)**2; return 2*r*Math.asin(Math.sqrt(x)); };
const compatible = { 'O-':['O-'], 'O+':['O-','O+'], 'A-':['O-','A-'], 'A+':['O-','O+','A-','A+'], 'B-':['O-','B-'], 'B+':['O-','O+','B-','B+'], 'AB-':['O-','A-','B-','AB-'], 'AB+':['O-','O+','A-','A+','B-','B+','AB-','AB+'] };

async function api(req, res, url) {
  const store = readStore();
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method === 'GET' && url.pathname === '/api/stats') return json(res, 200, { donors: store.users.filter(u=>u.role==='donor').length, organizations: store.organizations.length, openRequests: store.requests.filter(r=>r.status==='open').length, fulfilled: store.requests.filter(r=>r.status==='fulfilled').length });
  if (req.method === 'GET' && url.pathname === '/api/me') { const user=auth(req,store); return user ? json(res,200,safeUser(user)) : json(res,401,{error:'Your session has expired. Please sign in again.'}); }
  if (req.method === 'GET' && url.pathname === '/api/requests') { const mine=url.searchParams.get('mine')==='true'; const user=mine?auth(req,store):null; if(mine&&!user)return json(res,401,{error:'Please sign in to see your requests.'}); return json(res,200,store.requests.filter(r=>mine?r.ownerId===user.id:r.status==='open').sort((a,b)=>new Date(a.neededBy)-new Date(b.neededBy))); }
  if (req.method === 'GET' && url.pathname === '/api/organizations') { const lat=Number(url.searchParams.get('lat')),lng=Number(url.searchParams.get('lng')),blood=url.searchParams.get('blood');let rows=store.organizations.filter(o=>!blood||Number(o.inventory?.[blood]||0)>0);if(Number.isFinite(lat)&&Number.isFinite(lng))rows=rows.map(o=>({...o,distanceKm:+distance(lat,lng,o.lat,o.lng).toFixed(1)})).sort((a,b)=>a.distanceKm-b.distanceKm);return json(res,200,rows); }
  if (req.method === 'GET' && url.pathname === '/api/donors') {
    const blood = url.searchParams.get('blood'); const lat = Number(url.searchParams.get('lat')); const lng = Number(url.searchParams.get('lng'));
    let donors = store.users.filter(u=>u.role==='donor' && u.available && (!blood || compatible[blood]?.includes(u.bloodGroup))).map(safeUser);
    if (Number.isFinite(lat) && Number.isFinite(lng)) donors = donors.map(d=>({...d, distanceKm:+distance(lat,lng,d.lat,d.lng).toFixed(1)})).sort((a,b)=>a.distanceKm-b.distanceKm);
    return json(res, 200, donors);
  }
  if (req.method === 'POST' && url.pathname === '/api/register') {
    const b = await body(req); const required = ['name','email','password','phone','bloodGroup','city'];
    if (required.some(k=>!String(b[k]||'').trim())) return json(res, 400, { error:'Please complete every required field.' });
    if (!/^\S+@\S+\.\S+$/.test(b.email)) return json(res,400,{error:'Enter a valid email address.'});
    if (String(b.password).length < 8) return json(res,400,{error:'Password must contain at least 8 characters.'});
    if (store.users.some(u=>u.email.toLowerCase()===b.email.toLowerCase())) return json(res, 409, { error:'An account already exists for this email.' });
    const user = { id:id(), name:b.name.trim(), email:b.email.toLowerCase(), password:hash(b.password), phone:b.phone, bloodGroup:b.bloodGroup, city:b.city, lat:Number(b.lat)||12.9716, lng:Number(b.lng)||77.5946, role:b.role==='patient'?'patient':'donor', available:b.role!=='patient', createdAt:new Date().toISOString() };
    store.users.push(user); writeStore(store); return json(res,201,{token:createToken(user.id),user:safeUser(user)});
  }
  if (req.method === 'POST' && url.pathname === '/api/organizations') {
    const b = await body(req); if (!b.name || !b.email || !b.password || !b.phone || !b.city || !b.license) return json(res,400,{error:'Please complete every required field.'});
    if(store.users.some(u=>u.email.toLowerCase()===String(b.email).toLowerCase())) return json(res,409,{error:'An account already exists for this email.'});
    if(String(b.password).length<8) return json(res,400,{error:'Password must contain at least 8 characters.'});
    const owner = { id:id(), name:b.contactName||b.name, email:b.email.toLowerCase(), password:hash(b.password), phone:b.phone, role:'organization', city:b.city, createdAt:new Date().toISOString() };
    const org = { id:id(), name:b.name, type:b.type||'Blood bank', phone:b.phone, email:b.email.toLowerCase(), city:b.city, address:b.address||b.city, license:b.license, lat:Number(b.lat)||12.9716, lng:Number(b.lng)||77.5946, verified:false, inventory:b.inventory||{} };
    owner.organizationId=org.id; store.users.push(owner); store.organizations.push(org); writeStore(store); return json(res,201,{token:createToken(owner.id),user:safeUser(owner),organization:org});
  }
  if (req.method === 'POST' && url.pathname === '/api/login') {
    const b=await body(req); const user=store.users.find(u=>u.email.toLowerCase()===String(b.email||'').toLowerCase()); if(!user||!verify(b.password,user.password)) return json(res,401,{error:'Incorrect email or password.'}); return json(res,200,{token:createToken(user.id),user:safeUser(user)});
  }
  if (req.method === 'PATCH' && url.pathname === '/api/me') { const user=auth(req,store);if(!user)return json(res,401,{error:'Please sign in again.'});const b=await body(req);if(user.role==='donor'&&typeof b.available==='boolean')user.available=b.available;if(b.phone)user.phone=String(b.phone).trim();if(b.city)user.city=String(b.city).trim();if(Number.isFinite(Number(b.lat)))user.lat=Number(b.lat);if(Number.isFinite(Number(b.lng)))user.lng=Number(b.lng);writeStore(store);return json(res,200,safeUser(user)); }
  if (req.method === 'POST' && url.pathname === '/api/requests') {
    const user=auth(req,store); if(!user) return json(res,401,{error:'Please sign in before posting a request.'}); const b=await body(req); if(!b.patientName||!b.bloodGroup||!b.units||!b.hospital||!b.phone) return json(res,400,{error:'Please complete the request details.'});
    const units=Number(b.units);if(!Number.isInteger(units)||units<1||units>12)return json(res,400,{error:'Units must be between 1 and 12.'});const neededBy=b.neededBy?new Date(b.neededBy):new Date(Date.now()+86400000);if(Number.isNaN(neededBy.getTime())||neededBy.getTime()<Date.now()-300000)return json(res,400,{error:'Choose a future date and time.'});
    const request={id:id(),ownerId:user.id,patientName:String(b.patientName).trim(),bloodGroup:b.bloodGroup,units,component:b.component||'Whole blood',hospital:String(b.hospital).trim(),city:String(b.city||user.city||'').trim(),phone:String(b.phone).trim(),notes:String(b.notes||'').trim(),neededBy:neededBy.toISOString(),lat:Number(b.lat)||user.lat||12.9716,lng:Number(b.lng)||user.lng||77.5946,status:'open',createdAt:new Date().toISOString()}; store.requests.push(request); writeStore(store); return json(res,201,request);
  }
  const requestMatch=url.pathname.match(/^\/api\/requests\/([^/]+)$/);
  if(req.method==='PATCH'&&requestMatch){const user=auth(req,store);if(!user)return json(res,401,{error:'Please sign in again.'});const request=store.requests.find(r=>r.id===requestMatch[1]);if(!request)return json(res,404,{error:'Request not found.'});if(request.ownerId!==user.id&&user.role!=='organization')return json(res,403,{error:'You cannot update this request.'});const b=await body(req);if(!['open','fulfilled','cancelled'].includes(b.status))return json(res,400,{error:'Invalid request status.'});request.status=b.status;request.updatedAt=new Date().toISOString();writeStore(store);return json(res,200,request);}
  return json(res,404,{error:'Not found'});
}

const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
http.createServer(async (req,res)=>{ try { const url=new URL(req.url,`http://${req.headers.host}`); if(url.pathname.startsWith('/api/')) return await api(req,res,url); let file=url.pathname==='/'?path.join(PUBLIC,'index.html'):path.join(PUBLIC,url.pathname); if(!file.startsWith(PUBLIC)||!fs.existsSync(file)||fs.statSync(file).isDirectory()) file=path.join(PUBLIC,'index.html'); res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'}); fs.createReadStream(file).pipe(res); } catch(e){ console.error(e); json(res,500,{error:'Something went wrong. Please try again.'}); } }).listen(PORT,()=>console.log(`RedConnect is running at http://localhost:${PORT}`));
