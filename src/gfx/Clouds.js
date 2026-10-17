import * as THREE from 'three/webgpu';
import { Fn, vec3, vec4, If, Break, smoothstep, texture3D, uniform, mix } from 'three/tsl';
import { RaymarchingBox } from 'three/addons/tsl/utils/Raymarching.js';

export const CLOUD_QUALITY = Object.freeze({
  off: { steps:0, opacity:0 },
  low: { steps:12, opacity:0.20 },
  medium: { steps:20, opacity:0.155 },
  high: { steps:32, opacity:0.128 },
  ultra: { steps:46, opacity:0.108 }
});

const CLOUD_SPAN=2100;
const CLOUD_THICKNESS=96;
const CLOUD_BOTTOM=146;

function smooth(t){t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);}
function fract(t){return t-Math.floor(t);}
function hash3(x,y,z,seed){
  let k=Math.imul(x,374761393)^Math.imul(y,668265263)^Math.imul(z,1442695041)^seed;
  k=Math.imul(k^(k>>>13),1274126177);
  return ((k^(k>>>16))>>>0)/4294967295;
}
function periodicNoise3(x,y,z,frequency,seed) {
  const px=x*frequency,pz=z*frequency,py=y*frequency*0.82;
  const ix=Math.floor(px),iy=Math.floor(py),iz=Math.floor(pz);
  const tx=smooth(fract(px)),ty=smooth(fract(py)),tz=smooth(fract(pz));
  const sample=(dx,dy,dz)=>hash3((ix+dx)%frequency,iy+dy,(iz+dz)%frequency,seed);
  const a=sample(0,0,0)+(sample(1,0,0)-sample(0,0,0))*tx;
  const b=sample(0,0,1)+(sample(1,0,1)-sample(0,0,1))*tx;
  const c=sample(0,1,0)+(sample(1,1,0)-sample(0,1,0))*tx;
  const d=sample(0,1,1)+(sample(1,1,1)-sample(0,1,1))*tx;
  return (a+(b-a)*tz)*(1-ty)+(c+(d-c)*tz)*ty;
}

export function createCloudDensityTexture() {
  const nx=96,ny=48,nz=96,bytes=new Uint8Array(nx*ny*nz);
  let i=0;
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
    const u=x/nx,v=y/(ny-1),w=z/nz;
    const warp=(periodicNoise3(u,v,w,7,211)-0.5)*0.07;
    const uu=u+warp, ww=w-warp*0.7;
    const coverage=periodicNoise3(uu,0,ww,4,211)*0.60+
      periodicNoise3(uu,0,ww,9,511)*0.28+
      periodicNoise3(uu,0,ww,17,911)*0.12;
    const body=periodicNoise3(uu,v*0.66,ww,5,771)*0.50+
      periodicNoise3(uu,v*1.27,ww,11,901)*0.32+
      periodicNoise3(uu,v*2.10,ww,19,122)*0.18;
    const billow=Math.max(0,(body-0.40)*2.8 + (coverage-0.54)*1.55);
    const bottomLift=smooth((v-0.04)/0.11);
    const topFall=1-smooth((v-0.56-(coverage-0.5)*0.18)/0.28);
    const softEdges=smooth((coverage-0.38)/0.42);
    const density=Math.max(0,Math.min(1,billow*bottomLift*topFall*softEdges));
    bytes[i++]=Math.round(255*density);
  }
  const t=new THREE.Data3DTexture(bytes,nx,ny,nz);
  t.format=THREE.RedFormat;
  t.type=THREE.UnsignedByteType;
  t.magFilter=THREE.LinearFilter;
  t.minFilter=THREE.LinearFilter;
  t.wrapS=t.wrapR=THREE.RepeatWrapping;
  t.wrapT=THREE.ClampToEdgeWrapping;
  t.unpackAlignment=1;
  t.generateMipmaps=false;
  t.needsUpdate=true;
  return t;
}

export class Clouds {
  constructor(scene,camera,sunDirection) {
    this.scene=scene;
    this.camera=camera;
    this.direction=sunDirection;
    this.quality='high';
    this.speed=1;
    this.elapsed=0;
    this.noise=createCloudDensityTexture();
    this.wind=uniform(new THREE.Vector3(0,0,0));
    this.sun=uniform(sunDirection.clone().normalize());
    this.steps=uniform(32);
    this.opacity=uniform(0.128);
    this.sunlit=uniform(new THREE.Color('#f9f2e3'));
    this.shadowed=uniform(new THREE.Color('#7c8b9d'));

    const shader=Fn(({texture,wind,sun,steps,opacity,sunlit,shadowed})=>{
      const accum=vec4(0).toVar();
      RaymarchingBox(steps,({positionRay})=>{
        const local=positionRay.add(0.5);
        const point=local.add(wind);
        const d=texture.sample(point).r.toVar();
        If(d.greaterThan(0.032),()=>{
          const amount=smoothstep(0.03,0.58,d).mul(opacity).toVar();
          const ahead=texture.sample(point.add(sun.mul(vec3(0.012,0.030,0.012)))).r;
          const scattered=d.sub(ahead).mul(2.0).add(local.y.mul(0.14)).add(0.54).clamp(0.08,1.0);
          const lit=mix(shadowed,sunlit,scattered);
          const rim=smoothstep(0.18,0.78,scattered).mul(0.075);
          const col=lit.add(rim);
          const contribution=accum.a.oneMinus().mul(amount);
          accum.rgb.addAssign(contribution.mul(col));
          accum.a.addAssign(contribution);
        });
        If(accum.a.greaterThanEqual(0.965),()=>{Break();});
      });
      return accum;
    });

    const base=shader({
      texture:texture3D(this.noise,null,0),
      wind:this.wind,sun:this.sun,steps:this.steps,opacity:this.opacity,
      sunlit:this.sunlit,shadowed:this.shadowed
    });
    const mat=new THREE.NodeMaterial();
    mat.colorNode=base;
    mat.side=THREE.BackSide;
    mat.transparent=true;
    mat.depthWrite=false;
    mat.depthTest=true;
    mat.fog=false;
    mat.name='verdant-raymarched-clouds';
    this.mesh=new THREE.Mesh(new THREE.BoxGeometry(CLOUD_SPAN,CLOUD_THICKNESS,CLOUD_SPAN),mat);
    this.mesh.position.y=CLOUD_BOTTOM+CLOUD_THICKNESS/2;
    this.mesh.frustumCulled=false;
    this.mesh.renderOrder=-93;
    scene.add(this.mesh);
  }

  setQuality(mode) {
    this.quality=Object.hasOwn(CLOUD_QUALITY,mode)?mode:'high';
    this.mesh.visible=this.quality!=='off';
    const cfg=CLOUD_QUALITY[this.quality];
    this.steps.value=cfg.steps;
    this.opacity.value=cfg.opacity;
  }
  setSpeed(value){this.speed=Math.max(0,Math.min(3,value));}
  update(dt){
    this.elapsed+=dt*this.speed;
    this.mesh.position.x=this.camera.position.x;
    this.mesh.position.z=this.camera.position.z;
    this.wind.value.set(
      this.camera.position.x/CLOUD_SPAN+this.elapsed*0.000021,
      0,
      this.camera.position.z/CLOUD_SPAN+this.elapsed*0.000008
    );
  }
  dispose(){
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();this.mesh.material.dispose();this.noise.dispose();
  }
}
