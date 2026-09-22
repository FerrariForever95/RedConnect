const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8080);
const PUBLIC = path.join(__dirname, 'public');
const DATA = path.join(__dirname, 'data', 'store.json');
const sessions = new Map();

const readStore = () => JSON.parse(fs.readFileSync(DATA, 'utf8'));
const writeStore = (data) => fs.writeFileSync(DATA, JSON.stringify(data, null, 2));
const id = () => crypto.randomUUID();
const hash = (password, salt = crypto.randomBytes(16).toString('hex')) => `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
const verify = (password, saved = '') => { const [salt, key] = saved.split(':'); if (!salt || !key) return false; return crypto.timingSafeEqual(Buffer.from(key, 'hex'), crypto.scryptSync(password, salt, 64)); };
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(body)); };
const body = (req) => new Promise((resolve, reject) => { let raw = ''; req.on('data', c => { raw += c; if (raw.length > 1e6) req.destroy(); }); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } }); });
const auth = (req, store) => { const token = (req.headers.authorization || '').replace('Bearer ', ''); const userId = sessions.get(token); return store.users.find(u => u.id === userId); };
const safeUser = ({ password, ...user }) => user;
const distance = (a, b, c, d) => { const r = 6371, p = Math.PI / 180; const x = Math.sin((c-a)*p/2)**2 + Math.cos(a*p)*Math.cos(c*p)*Math.sin((d-b)*p/2)**2; return 2*r*Math.asin(Math.sqrt(x)); };
const compatible = { 'O-':['O-'], 'O+':['O-','O+'], 'A-':['O-','A-'], 'A+':['O-','O+','A-','A+'], 'B-':['O-','B-'], 'B+':['O-','O+','B-','B+'], 'AB-':['O-','A-','B-','AB-'], 'AB+':['O-','O+','A-','A+','B-','B+','AB-','AB+'] };

async function api(req, res, url) {
  const store = readStore();
  if (req.method === 'GET' && url.pathname === '/api/stats') return json(res, 200, { donors: store.users.filter(u=>u.role==='donor').length, organizations: store.organizations.length, openRequests: store.requests.filter(r=>r.status==='open').length, fulfilled: store.requests.filter(r=>r.status==='fulfilled').length });
  if (req.method === 'GET' && url.pathname === '/api/requests') return json(res, 200, store.requests.filter(r=>r.status==='open').sort((a,b)=>new Date(a.neededBy)-new Date(b.neededBy)));
  if (req.method === 'GET' && url.pathname === '/api/organizations') return json(res, 200, store.organizations);
  if (req.method === 'GET' && url.pathname === '/api/donors') {
    const blood = url.searchParams.get('blood'); const lat = Number(url.searchParams.get('lat')); const lng = Number(url.searchParams.get('lng'));
    let donors = store.users.filter(u=>u.role==='donor' && u.available && (!blood || compatible[blood]?.includes(u.bloodGroup))).map(safeUser);
    if (Number.isFinite(lat) && Number.isFinite(lng)) donors = donors.map(d=>({...d, distanceKm:+distance(lat,lng,d.lat,d.lng).toFixed(1)})).sort((a,b)=>a.distanceKm-b.distanceKm);
    return json(res, 200, donors);
  }
  if (req.method === 'POST' && url.pathname === '/api/register') {
    const b = await body(req); const required = ['name','email','password','phone','bloodGroup','city'];
    if (required.some(k=>!String(b[k]||'').trim())) return json(res, 400, { error:'Please complete every required field.' });
    if (store.users.some(u=>u.email.toLowerCase()===b.email.toLowerCase())) return json(res, 409, { error:'An account already exists for this email.' });
    const user = { id:id(), name:b.name.trim(), email:b.email.toLowerCase(), password:hash(b.password), phone:b.phone, bloodGroup:b.bloodGroup, city:b.city, lat:Number(b.lat)||12.9716, lng:Number(b.lng)||77.5946, role:b.role==='patient'?'patient':'donor', available:b.role!=='patient', createdAt:new Date().toISOString() };
    store.users.push(user); writeStore(store); const token=id(); sessions.set(token,user.id); return json(res,201,{token,user:safeUser(user)});
  }
  if (req.method === 'POST' && url.pathname === '/api/organizations') {
    const b = await body(req); if (!b.name || !b.email || !b.password || !b.phone || !b.city || !b.license) return json(res,400,{error:'Please complete every required field.'});
    const owner = { id:id(), name:b.contactName||b.name, email:b.email.toLowerCase(), password:hash(b.password), phone:b.phone, role:'organization', city:b.city, createdAt:new Date().toISOString() };
    const org = { id:id(), name:b.name, type:b.type||'Blood bank', phone:b.phone, email:b.email.toLowerCase(), city:b.city, address:b.address||b.city, license:b.license, lat:Number(b.lat)||12.9716, lng:Number(b.lng)||77.5946, verified:false, inventory:b.inventory||{} };
    store.users.push(owner); store.organizations.push(org); writeStore(store); const token=id(); sessions.set(token,owner.id); return json(res,201,{token,user:safeUser(owner),organization:org});
  }
  if (req.method === 'POST' && url.pathname === '/api/login') {
    const b=await body(req); const user=store.users.find(u=>u.email.toLowerCase()===String(b.email||'').toLowerCase()); if(!user||!verify(b.password,user.password)) return json(res,401,{error:'Incorrect email or password.'}); const token=id(); sessions.set(token,user.id); return json(res,200,{token,user:safeUser(user)});
  }
  if (req.method === 'POST' && url.pathname === '/api/requests') {
    const user=auth(req,store); if(!user) return json(res,401,{error:'Please sign in before posting a request.'}); const b=await body(req); if(!b.patientName||!b.bloodGroup||!b.units||!b.hospital||!b.phone) return json(res,400,{error:'Please complete the request details.'});
    const request={id:id(),ownerId:user.id,patientName:b.patientName,bloodGroup:b.bloodGroup,units:Number(b.units),component:b.component||'Whole blood',hospital:b.hospital,city:b.city||user.city,phone:b.phone,notes:b.notes||'',neededBy:b.neededBy||new Date(Date.now()+86400000).toISOString(),lat:Number(b.lat)||user.lat||12.9716,lng:Number(b.lng)||user.lng||77.5946,status:'open',createdAt:new Date().toISOString()}; store.requests.push(request); writeStore(store); return json(res,201,request);
  }
  return json(res,404,{error:'Not found'});
}

const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
http.createServer(async (req,res)=>{ try { const url=new URL(req.url,`http://${req.headers.host}`); if(url.pathname.startsWith('/api/')) return await api(req,res,url); let file=url.pathname==='/'?path.join(PUBLIC,'index.html'):path.join(PUBLIC,url.pathname); if(!file.startsWith(PUBLIC)||!fs.existsSync(file)||fs.statSync(file).isDirectory()) file=path.join(PUBLIC,'index.html'); res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'}); fs.createReadStream(file).pipe(res); } catch(e){ console.error(e); json(res,500,{error:'Something went wrong. Please try again.'}); } }).listen(PORT,()=>console.log(`RedConnect is running at http://localhost:${PORT}`));
