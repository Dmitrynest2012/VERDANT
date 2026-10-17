import * as THREE from 'three/webgpu';

const BLUE_HAZE=new THREE.Color('#91bbd5');
const CAVE_HAZE=new THREE.Color('#0f151a');
const SUN_DIRECTION=new THREE.Vector3(-0.58,0.78,-0.24).normalize();
const SUN_DISTANCE=1870;
const SOLAR_DIAMETER_DEG=0.62;
const SUN_DISK_DIAMETER=2*SUN_DISTANCE*Math.tan((SOLAR_DIAMETER_DEG*Math.PI/180)/2);
const TMP=new THREE.Vector3();
const TMP2=new THREE.Vector3();
const CAM_FWD=new THREE.Vector3();

function smooth01(t){t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);}

function makeSkyGradient() {
  const canvas=document.createElement('canvas');canvas.width=4;canvas.height=1024;
  const ctx=canvas.getContext('2d');
  const g=ctx.createLinearGradient(0,0,0,1024);
  g.addColorStop(0,'#1f5f97');
  g.addColorStop(.18,'#3c86ba');
  g.addColorStop(.38,'#69abd3');
  g.addColorStop(.54,'#a2cee7');
  g.addColorStop(.70,'#d0e2ed');
  g.addColorStop(1,'#dce4e9');
  ctx.fillStyle=g;ctx.fillRect(0,0,4,1024);
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;
  map.magFilter=THREE.LinearFilter;map.minFilter=THREE.LinearFilter;
  return map;
}

function createSunMap(kind) {
  const size=512;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
  const ctx=canvas.getContext('2d');
  const g=ctx.createRadialGradient(256,256,0,256,256,255);
  if(kind==='disc') {
    g.addColorStop(0,'rgba(255,255,245,1)');
    g.addColorStop(.62,'rgba(255,251,240,1)');
    g.addColorStop(.82,'rgba(255,246,224,.98)');
    g.addColorStop(.96,'rgba(255,239,208,.30)');
    g.addColorStop(1,'rgba(255,239,208,0)');
  } else {
    g.addColorStop(0,'rgba(255,245,212,.12)');
    g.addColorStop(.16,'rgba(255,236,201,.06)');
    g.addColorStop(.38,'rgba(255,227,196,.025)');
    g.addColorStop(1,'rgba(255,238,209,0)');
  }
  ctx.fillStyle=g;ctx.fillRect(0,0,size,size);
  const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;
  t.minFilter=t.magFilter=THREE.LinearFilter;
  return t;
}

function makeFxRoot(){
  let root=document.getElementById('sun-fx');
  if(root) return root;
  root=document.createElement('div');
  root.id='sun-fx';
  root.className='sun-fx';
  const adapt=document.createElement('div'); adapt.className='eye-adapt'; root.appendChild(adapt);
  for(let i=0;i<3;i++){
    const flare=document.createElement('div');
    flare.className=`sun-flare flare-${i+1}`;
    root.appendChild(flare);
  }
  document.body.appendChild(root);
  return root;
}

export class Environment {
  constructor(scene,camera) {
    this.scene=scene;this.camera=camera;
    this.direction=SUN_DIRECTION.clone();
    this.fogAmount=50;
    this.viewDistance=200;
    this.sunTime=0;
    this.glare=0;
    this.adaptation=0;
    this.fxRoot=makeFxRoot();
    this.adaptEl=this.fxRoot.querySelector('.eye-adapt');
    this.flares=[...this.fxRoot.querySelectorAll('.sun-flare')];
    const skyRadius=2190;
    this.dome=new THREE.Mesh(
      new THREE.SphereGeometry(skyRadius,64,48),
      new THREE.MeshBasicMaterial({map:makeSkyGradient(),side:THREE.BackSide,depthWrite:false,depthTest:false,fog:false})
    );
    this.dome.frustumCulled=false;
    this.dome.renderOrder=-100;
    scene.add(this.dome);

    this.disc=new THREE.Sprite(new THREE.SpriteMaterial({map:createSunMap('disc'),transparent:true,depthTest:false,depthWrite:false,fog:false}));
    this.disc.scale.set(SUN_DISK_DIAMETER*1.22,SUN_DISK_DIAMETER*1.22,1);
    this.disc.renderOrder=-98;

    this.outerGlow=new THREE.Sprite(new THREE.SpriteMaterial({map:createSunMap('scatter'),transparent:true,blending:THREE.AdditiveBlending,depthTest:false,depthWrite:false,fog:false,opacity:0.18}));
    this.outerGlow.scale.set(SUN_DISK_DIAMETER*10,SUN_DISK_DIAMETER*10,1);
    this.outerGlow.renderOrder=-99;
    scene.add(this.outerGlow,this.disc);

    const sun=new THREE.DirectionalLight('#fff1dc',3.15);
    sun.castShadow=true;
    sun.shadow.mapSize.set(2048,2048);
    sun.shadow.camera.left=-62;sun.shadow.camera.right=62;
    sun.shadow.camera.top=62;sun.shadow.camera.bottom=-62;
    sun.shadow.camera.near=0.5;sun.shadow.camera.far=260;
    sun.shadow.bias=-.00015;sun.shadow.normalBias=.025;
    sun.shadow.radius=2;
    scene.add(sun,sun.target);this.sun=sun;
    this.ambient=new THREE.AmbientLight('#d7edf8',.012);
    this.hemisphere=new THREE.HemisphereLight('#bbdff3','#484039',.31);
    scene.add(this.ambient,this.hemisphere);
    scene.fog=new THREE.Fog(BLUE_HAZE.clone(),90,210);
    this.update(0,1);
  }
  setViewDistance(meters){this.viewDistance=Math.max(50,Math.min(1000,meters));}
  setFog(amount){this.fogAmount=Math.max(0,Math.min(100,amount));}
  setShadows(mode) {
    const size=({off:0,low:1024,medium:2048,high:3072,ultra:4096})[mode]??2048;
    this.sun.castShadow=size>0;
    if(size&&this.sun.shadow.mapSize.x!==size){
      this.sun.shadow.map?.dispose();this.sun.shadow.map=null;
      this.sun.shadow.mapSize.set(size,size);this.sun.shadow.needsUpdate=true;
    }
  }
  update(dt=0,sky=1) {
    const p=this.camera.position;
    this.dome.position.copy(p);
    const sunPosition=TMP.copy(this.direction).multiplyScalar(SUN_DISTANCE).add(p);
    this.disc.position.copy(sunPosition);
    this.outerGlow.position.copy(sunPosition);
    this.sun.target.position.set(p.x,p.y-1.1,p.z);
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.direction,126);
    this.sun.target.updateMatrixWorld();
    this.sunTime+=dt;

    const underground=Math.max(0,Math.min(1,1-sky));
    this.scene.fog.color.copy(BLUE_HAZE).lerp(CAVE_HAZE,underground*.98);
    if(this.fogAmount<=0) {
      this.scene.fog.near=50000;this.scene.fog.far=55000;
    } else {
      const strength=this.fogAmount/100;
      const near=this.viewDistance*(0.71-0.57*strength);
      const far=this.viewDistance*(1.23-0.34*strength);
      this.scene.fog.near=Math.max(8,near*(1-underground*.69));
      this.scene.fog.far=Math.max(this.scene.fog.near+14,far*(1-underground*.58));
    }

    const screen=TMP2.copy(sunPosition).project(this.camera);
    this.camera.getWorldDirection(CAM_FWD);
    const align=smooth01((CAM_FWD.dot(this.direction)-0.92)/0.08)*sky;
    const onScreen=screen.z < 1 && screen.z > -1 && Math.abs(screen.x) < 1.35 && Math.abs(screen.y) < 1.35;
    const visible=onScreen ? align : 0;
    this.glare += (visible - this.glare) * Math.min(1, dt * 5.5);
    this.adaptation += (visible - this.adaptation) * Math.min(1, dt * (visible > this.adaptation ? 1.6 : 0.6));
    const afterImage=Math.max(0,this.adaptation-visible);
    this.adaptEl.style.opacity=`${Math.min(0.22, afterImage*0.24)}`;

    const sx=(screen.x*0.5+0.5)*window.innerWidth;
    const sy=(-screen.y*0.5+0.5)*window.innerHeight;
    const cx=window.innerWidth*0.5, cy=window.innerHeight*0.5;
    const vx=cx-sx, vy=cy-sy;
    const scales=[0.28,0.50,0.78];
    const flareOpacity=[0.055,0.040,0.030];
    this.flares.forEach((flare,i)=>{
      const factor=scales[i];
      const x=sx+vx*factor, y=sy+vy*factor;
      const base=48+36*i;
      flare.style.transform=`translate(${x-base/2}px, ${y-base/2}px)`;
      flare.style.width=`${base}px`;
      flare.style.height=`${base}px`;
      flare.style.opacity=String(visible*flareOpacity[i]);
      flare.style.display=visible>0.02 && onScreen ? 'block' : 'none';
    });
  }
}
