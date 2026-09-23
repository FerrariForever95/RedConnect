(function(){
  const button=document.getElementById('findEmergency'),list=document.getElementById('emergencyList'),hint=document.getElementById('emergencyHint');
  if(!button||!list)return;
  const safe=value=>String(value||'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const distance=(a,b,c,d)=>{const r=6371,p=Math.PI/180,x=Math.sin((c-a)*p/2)**2+Math.cos(a*p)*Math.cos(c*p)*Math.sin((d-b)*p/2)**2;return +(2*r*Math.asin(Math.sqrt(x))).toFixed(1)};
  async function load(lat,lng){
    button.disabled=true;button.textContent='Finding care…';hint.textContent='Searching within 10 km of your location…';list.innerHTML='<div class="emergency-loading">Checking OpenStreetMap for hospitals and clinics.</div>';
    const cacheKey=`care:${lat.toFixed(2)}:${lng.toFixed(2)}`;
    try{
      let elements;const cached=sessionStorage.getItem(cacheKey);
      if(cached)elements=JSON.parse(cached);else{const latDelta=.09,lngDelta=.09/Math.max(Math.cos(lat*Math.PI/180),.35),params=new URLSearchParams({format:'jsonv2',q:'hospital',viewbox:`${lng-lngDelta},${lat+latDelta},${lng+lngDelta},${lat-latDelta}`,bounded:'1',limit:'12',addressdetails:'1',extratags:'1'});const response=await fetch(`https://nominatim.openstreetmap.org/search?${params}`);if(!response.ok)throw new Error('Nearby care service is temporarily busy.');elements=await response.json();sessionStorage.setItem(cacheKey,JSON.stringify(elements))}
      const rows=elements.map(item=>{const itemLat=Number(item.lat),itemLng=Number(item.lon),extra=item.extratags||{};return{id:item.place_id,name:item.name||String(item.display_name||'Hospital').split(',')[0],type:'Hospital',phone:extra['contact:phone']||extra.phone||extra['contact:mobile'],lat:itemLat,lng:itemLng,distanceKm:distance(lat,lng,itemLat,itemLng)}}).filter(item=>Number.isFinite(item.lat)&&Number.isFinite(item.lng)).sort((a,b)=>a.distanceKm-b.distanceKm).slice(0,12);
      hint.textContent=rows.length?`${rows.length} nearby facilities, nearest first.`:'No mapped facilities were found within 10 km.';
      list.innerHTML=rows.length?rows.map(item=>`<article class="care-item"><div><strong>${safe(item.name)}</strong><span>${safe(item.type)}</span><span class="care-distance">${item.distanceKm} km away</span></div><div class="care-actions">${item.phone?`<a href="tel:${safe(item.phone)}">Call</a>`:''}<a href="https://www.openstreetmap.org/?mlat=${item.lat}&mlon=${item.lng}#map=17/${item.lat}/${item.lng}" target="_blank" rel="noopener">Directions</a></div></article>`).join(''):'<div class="empty"><strong>No facilities found</strong><span>Call 112 or 108 for immediate assistance.</span></div>';
    }catch(error){hint.textContent='Nearby facility search is unavailable.';list.innerHTML=`<div class="empty"><strong>Could not load nearby care</strong><span>${safe(error.message)} Call 112 or 108 in an emergency.</span></div>`}finally{button.disabled=false;button.textContent='Find nearby care'}
  }
  button.addEventListener('click',()=>{if(!navigator.geolocation){hint.textContent='Location is not supported by this browser.';return}hint.textContent='Requesting your location…';navigator.geolocation.getCurrentPosition(pos=>load(pos.coords.latitude,pos.coords.longitude),()=>{hint.textContent='Location permission was not available. Use 112 or 108 for immediate help.'},{timeout:8000})});
  addEventListener('redconnect:location',event=>load(event.detail.lat,event.detail.lng));
})();
