import * as THREE from 'three/webgpu';
import {flareLayout, sunScreenVisibility} from '../core/SunOptics.js';

const BLUE_HAZE=new THREE.Color('#91bbd5'),CAVE_HAZE=new THREE.Color('#0f151a');
const SUN_DIRECTION=new THREE.Vector3(-.58,.78,-.24).normalize(),SUN_DISTANCE=1870,SOLAR_DIAMETER_DEG=.62;
const SUN_DISK_DIAMETER=2*SUN_DISTANCE*Math.tan(SOLAR_DIAMETER_DEG*Math.PI/360);
const TMP=new THREE.Vector3(),TMP2=new THREE.Vector3(),CAM_FWD=new THREE.Vector3();
function makeSkyGradient(){
 const canvas=document.createElement('canvas');canvas.width=4;canvas.height=1024;const ctx=canvas.getContext('2d'),g=ctx.createLinearGradient(0,0,0,1024);
 for(const [s,c]of [[0,'#165894'],[.12,'#2d7db8'],[.34,'#59a6d6'],[.58,'#9ed0ea'],[.78,'#c8e3f0'],[1,'#dfe7ea']])g.addColorStop(s,c);
 ctx.fillStyle=g;ctx.fillRect(0,0,4,1024);const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;map.magFilter=map.minFilter=THREE.LinearFilter;return map;
}
function createSunMap(kind){
 const size=1024,canvas=document.createElement('canvas');canvas.width=canvas.height=size;
 const ctx=canvas.getContext('2d');ctx.clearRect(0,0,size,size);
 const stops=kind==='disc'?[[0,'rgba(255,255,250,1)'],[.18,'rgba(255,252,242,1)'],[.48,'rgba(255,246,224,.98)'],[.72,'rgba(255,230,181,.84)'],[.88,'rgba(255,211,153,.22)'],[1,'rgba(255,211,153,0)']]
  :kind==='halo'?[[0,'rgba(255,247,214,.16)'],[.10,'rgba(255,239,197,.10)'],[.38,'rgba(255,225,164,.05)'],[1,'rgba(255,225,164,0)']]
  :[[0,'rgba(255,233,182,.07)'],[.30,'rgba(255,211,150,.04)'],[.60,'rgba(255,178,120,.015)'],[1,'rgba(255,178,120,0)']];
 const g=ctx.createRadialGradient(size/2,size/2,0,size/2,size/2,size/2-2);for(const [s,c]of stops)g.addColorStop(s,c);
 ctx.fillStyle=g;ctx.fillRect(0,0,size,size);const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;t.minFilter=t.magFilter=THREE.LinearFilter;return t;
}
function makeFxRoot(){
 let root=document.getElementById('sun-fx');if(root)return root;
 root=document.createElement('div');root.id='sun-fx';root.className='sun-fx';
 const adapt=document.createElement('div');adapt.className='eye-adapt';root.appendChild(adapt);
 const bloom=document.createElement('div');bloom.className='sun-bloom';root.appendChild(bloom);
 for(let i=0;i<3;i++){const flare=document.createElement('div');flare.className=`sun-flare flare-${i+1}`;root.appendChild(flare);}
 document.body.appendChild(root);return root;
}
export class Environment{
 constructor(scene,camera){
  this.scene=scene;this.camera=camera;this.direction=SUN_DIRECTION.clone();this.fogAmount=50;this.viewDistance=200;
  this.sunTime=0;this.glare=0;this.adaptation=0;this.world=null;this.sunUnoccluded=1;this.occlusionElapsed=1;
  this.fxRoot=makeFxRoot();this.adaptEl=this.fxRoot.querySelector('.eye-adapt');this.bloomEl=this.fxRoot.querySelector('.sun-bloom');this.flares=[...this.fxRoot.querySelectorAll('.sun-flare')];
  this.dome=new THREE.Mesh(new THREE.SphereGeometry(2190,64,48),new THREE.MeshBasicMaterial({map:makeSkyGradient(),side:THREE.BackSide,depthWrite:false,depthTest:false,fog:false}));
  this.dome.frustumCulled=false;this.dome.renderOrder=-100;scene.add(this.dome);
  this.disc=new THREE.Sprite(new THREE.SpriteMaterial({map:createSunMap('disc'),transparent:true,depthTest:false,depthWrite:false,fog:false}));
  this.disc.scale.set(SUN_DISK_DIAMETER*1.26,SUN_DISK_DIAMETER*1.26,1);this.disc.renderOrder=-98;
  this.halo=new THREE.Sprite(new THREE.SpriteMaterial({map:createSunMap('halo'),transparent:true,blending:THREE.AdditiveBlending,depthTest:false,depthWrite:false,fog:false,opacity:.62}));
  this.halo.scale.set(SUN_DISK_DIAMETER*5.2,SUN_DISK_DIAMETER*5.2,1);this.halo.renderOrder=-99;
  this.outerGlow=new THREE.Sprite(new THREE.SpriteMaterial({map:createSunMap('scatter'),transparent:true,blending:THREE.AdditiveBlending,depthTest:false,depthWrite:false,fog:false,opacity:.24}));
  this.outerGlow.scale.set(SUN_DISK_DIAMETER*13.5,SUN_DISK_DIAMETER*13.5,1);this.outerGlow.renderOrder=-99;scene.add(this.outerGlow,this.halo,this.disc);
  const sun=new THREE.DirectionalLight('#fff1dc',3.15);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);
  sun.shadow.camera.left=-62;sun.shadow.camera.right=62;sun.shadow.camera.top=62;sun.shadow.camera.bottom=-62;
  sun.shadow.camera.near=.5;sun.shadow.camera.far=260;sun.shadow.bias=-.00015;sun.shadow.normalBias=.025;sun.shadow.radius=2;
  scene.add(sun,sun.target);this.sun=sun;
  this.ambient=new THREE.AmbientLight('#d7edf8',.012);this.hemisphere=new THREE.HemisphereLight('#bbdff3','#484039',.31);scene.add(this.ambient,this.hemisphere);
  scene.fog=new THREE.Fog(BLUE_HAZE.clone(),90,210);this.update(0,1);
 }
 setWorld(world){this.world=world;this.occlusionElapsed=1;}
 setViewDistance(meters){this.viewDistance=Math.max(50,Math.min(1000,meters));}
 setFog(amount){this.fogAmount=Math.max(0,Math.min(100,amount));}
 setShadows(mode){
  const size=({off:0,low:1024,medium:2048,high:3072,ultra:4096})[mode]??2048;
  this.sun.castShadow=size>0;
  if(size&&this.sun.shadow.mapSize.x!==size){this.sun.shadow.map?.dispose();this.sun.shadow.map=null;this.sun.shadow.mapSize.set(size,size);this.sun.shadow.needsUpdate=true;}
 }
 update(dt=0,sky=1){
  const p=this.camera.position;this.dome.position.copy(p);
  const sunPosition=TMP.copy(this.direction).multiplyScalar(SUN_DISTANCE).add(p);this.disc.position.copy(sunPosition);this.halo.position.copy(sunPosition);this.outerGlow.position.copy(sunPosition);
  this.sun.target.position.set(p.x,p.y-1.1,p.z);this.sun.position.copy(this.sun.target.position).addScaledVector(this.direction,126);this.sun.target.updateMatrixWorld();this.sunTime+=dt;
  const underground=Math.max(0,Math.min(1,1-sky));this.scene.fog.color.copy(BLUE_HAZE).lerp(CAVE_HAZE,underground*.98);
  if(this.fogAmount<=0){this.scene.fog.near=50000;this.scene.fog.far=55000;}
  else{const strength=this.fogAmount/100,near=this.viewDistance*(.71-.57*strength),far=this.viewDistance*(1.23-.34*strength);
   this.scene.fog.near=Math.max(8,near*(1-underground*.69));this.scene.fog.far=Math.max(this.scene.fog.near+14,far*(1-underground*.58));}
  // Проекция должна видеть текущую камеру, а не матрицу предыдущего кадра.
  this.camera.updateMatrixWorld(true);const screen=TMP2.copy(sunPosition).project(this.camera);this.camera.getWorldDirection(CAM_FWD);
  this.occlusionElapsed+=dt;
  if(this.world&&this.occlusionElapsed>=.15){this.occlusionElapsed=0;this.sunUnoccluded=this.world.raycast(p,this.direction,128)?0:1;}
  const underwater=this.world?.water?.pointDepth(p.x,p.y,p.z)>.035;
  const visible=underwater?0:sunScreenVisibility(screen.x,screen.y,CAM_FWD.dot(this.direction))*Math.max(0,Math.min(1,sky))*this.sunUnoccluded;
  this.disc.visible=this.halo.visible=this.outerGlow.visible=this.sunUnoccluded>0&&!underwater;
  this.glare+=(visible-this.glare)*(1-Math.exp(-dt*7));this.adaptation+=(visible-this.adaptation)*(1-Math.exp(-dt*(visible>this.adaptation?2.4:.95)));
  this.adaptEl.style.opacity=String(Math.min(.16,Math.max(0,this.adaptation-visible)*.18));
  const sx=(screen.x*.5+.5)*window.innerWidth,sy=(-screen.y*.5+.5)*window.innerHeight,finite=Number.isFinite(sx)&&Number.isFinite(sy),show=finite&&visible>.002;
  this.bloomEl.style.transform=finite?`translate(${sx-170}px, ${sy-170}px)`:'none';this.bloomEl.style.opacity=String(Math.min(.22,this.glare*.20));this.bloomEl.style.display=show?'block':'none';
  const layout=flareLayout(sx,sy,window.innerWidth,window.innerHeight,this.glare);
  this.flares.forEach((flare,i)=>{const spot=layout[i];if(!spot){flare.style.display='none';return;}
   flare.style.transform=`translate(${spot.x-spot.diameter/2}px, ${spot.y-spot.diameter/2}px)`;flare.style.width=flare.style.height=`${spot.diameter}px`;flare.style.opacity=String(spot.opacity);flare.style.display=show?'block':'none';});
 }
}
