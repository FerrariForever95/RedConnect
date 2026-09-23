import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.min.js';

const host=document.getElementById('heroScene');
if(host&&!matchMedia('(prefers-reduced-motion: reduce)').matches&&navigator.hardwareConcurrency>=4){
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(42,1,.1,100),renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setClearColor(0x000000,0);host.appendChild(renderer.domElement);camera.position.set(0,0,8);
  const group=new THREE.Group(),geometry=new THREE.SphereGeometry(.075,10,10),materials=[new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.68}),new THREE.MeshBasicMaterial({color:0xe72f49,transparent:true,opacity:.72})];
  for(let i=0;i<52;i++){const dot=new THREE.Mesh(geometry,materials[i%2]);const t=i/52*Math.PI*4.5;dot.position.set(Math.cos(t)*(1.2+i*.012),((i/52)-.5)*5.8,Math.sin(t)*.65);dot.userData={phase:i*.16,speed:.35+(i%7)*.025};group.add(dot)}
  scene.add(group);let visible=true,frame=0;const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting},{threshold:.05});observer.observe(host);
  const resize=()=>{const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()};new ResizeObserver(resize).observe(host);resize();
  const animate=time=>{frame=requestAnimationFrame(animate);if(!visible)return;const seconds=time*.001;group.rotation.y=Math.sin(seconds*.24)*.2;group.children.forEach(dot=>{dot.position.y+=Math.sin(seconds*dot.userData.speed+dot.userData.phase)*.0009;dot.scale.setScalar(.72+(Math.sin(seconds*1.4+dot.userData.phase)+1)*.18)});renderer.render(scene,camera)};frame=requestAnimationFrame(animate);
  addEventListener('pagehide',()=>{cancelAnimationFrame(frame);observer.disconnect();renderer.dispose();geometry.dispose();materials.forEach(m=>m.dispose())},{once:true});
}
