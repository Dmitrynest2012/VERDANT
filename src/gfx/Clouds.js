import * as THREE from 'three/webgpu';

export const CLOUD_QUALITY = Object.freeze({
  off: { count: 0 }, low: { count: 18 }, medium: { count: 30 }, high: { count: 42 }, ultra: { count: 56 }
});
const CLOUD_SPAN=2400,CLOUD_HALF=CLOUD_SPAN/2,CLOUD_BASE_HEIGHT=152,CLOUD_ALTITUDE_BAND=56,MAX_CLOUDS=56;
function wrapAround(value,center,span){const half=span*.5;while(value<center-half)value+=span;while(value>center+half)value-=span;return value;}
function mulberry32(seed){let t=seed>>>0;return()=>{t+=0x6D2B79F5;let r=Math.imul(t^(t>>>15),t|1);r^=r+Math.imul(r^(r>>>7),r|61);return((r^(r>>>14))>>>0)/4294967296;};}

/** Alpha сохраняется при затенении: прямоугольник вокруг облака не возникает. */
export function makeCloudTexture(){
 const size=512,canvas=document.createElement('canvas');canvas.width=canvas.height=size;
 const ctx=canvas.getContext('2d');ctx.clearRect(0,0,size,size);const rng=mulberry32(170621);
 for(let i=0;i<18;i++){
  const x=size*(.28+rng()*.44),y=size*(.32+rng()*.32),r=size*(.11+rng()*.095);
  const g=ctx.createRadialGradient(x,y,0,x,y,r);
  g.addColorStop(0,'rgba(255,255,255,.96)');g.addColorStop(.44,'rgba(255,255,255,.76)');
  g.addColorStop(.74,'rgba(255,255,255,.28)');g.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
 }
 const shadow=ctx.createLinearGradient(0,size*.32,0,size);
 shadow.addColorStop(0,'rgba(255,255,255,0)');shadow.addColorStop(.7,'rgba(150,166,185,.15)');shadow.addColorStop(1,'rgba(113,133,154,.28)');
 ctx.globalCompositeOperation='source-atop';ctx.fillStyle=shadow;ctx.fillRect(0,0,size,size);ctx.globalCompositeOperation='source-over';
 const pixels=ctx.getImageData(0,0,size,size);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const t=Math.max(0,Math.min(1,Math.min(x,y,size-1-x,size-1-y)/(size*.10)));
  pixels.data[(y*size+x)*4+3]=Math.round(pixels.data[(y*size+x)*4+3]*t*t*(3-2*t));
 }
 ctx.putImageData(pixels,0,0);
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
 texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;return texture;
}

export class Clouds{
 constructor(scene,camera,sunDirection){
  this.scene=scene;this.camera=camera;this.direction=sunDirection;this.quality='high';this.speed=1;this.elapsed=0;this.clouds=[];
  this.texture=makeCloudTexture();this.root=new THREE.Group();this.root.name='verdant-clouds';this.root.renderOrder=-95;this.root.frustumCulled=false;scene.add(this.root);
  const rng=mulberry32(91357),sunFacing=Math.max(.15,Math.min(1,sunDirection.y*.9+.55));
  const bright=new THREE.Color('#ffffff'),warm=new THREE.Color('#fff2d8'),shadow=new THREE.Color('#b8c8d6');
  for(let i=0;i<MAX_CLOUDS;i++){
   const group=new THREE.Group();group.frustumCulled=false;
   const puffCount=3+Math.floor(rng()*4),width=54+rng()*118,depth=20+rng()*34,altitude=CLOUD_BASE_HEIGHT+rng()*CLOUD_ALTITUDE_BAND,sprites=[];
   for(let j=0;j<puffCount;j++){
    const mat=new THREE.SpriteMaterial({map:this.texture,transparent:true,depthWrite:false,depthTest:true,fog:false,opacity:.78,
     color:bright.clone().lerp(warm,.25+.35*rng()).lerp(shadow,.18*(j/Math.max(1,puffCount-1)))});
    const sprite=new THREE.Sprite(mat),sx=width*(.34+rng()*.52),sy=sx*(.36+rng()*.16);sprite.scale.set(sx,sy,1);
    sprite.position.set((rng()-.5)*width,(rng()-.5)*depth,(rng()-.5)*10);sprite.material.opacity*=.84+.12*sunFacing;
    group.add(sprite);sprites.push(sprite);
   }
   const record={group,baseX:(rng()-.5)*CLOUD_SPAN,baseZ:(rng()-.5)*CLOUD_SPAN,driftX:.7+rng()*.8,driftZ:.15+rng()*.35,
    altitude,bob:rng()*Math.PI*2,phase:rng()*Math.PI*2,wobble:.8+rng()*1.6,sprites};
   group.visible=false;this.root.add(group);this.clouds.push(record);
  }
  this.setQuality('high');
 }
 setQuality(mode){this.quality=Object.hasOwn(CLOUD_QUALITY,mode)?mode:'high';const limit=CLOUD_QUALITY[this.quality].count;this.root.visible=limit>0;this.clouds.forEach((c,i)=>c.group.visible=i<limit);}
 setSpeed(value){this.speed=Math.max(0,Math.min(3,value));}
 update(dt){
  this.elapsed+=dt*this.speed;if(!this.root.visible)return;
  const cameraX=this.camera.position.x,cameraZ=this.camera.position.z;
  for(const cloud of this.clouds){
   if(!cloud.group.visible)continue;
   const x=wrapAround(cloud.baseX+this.elapsed*cloud.driftX,cameraX,CLOUD_SPAN),z=wrapAround(cloud.baseZ+this.elapsed*cloud.driftZ,cameraZ,CLOUD_SPAN);
   const dist=Math.hypot(x-cameraX,z-cameraZ),fadeStart=CLOUD_HALF*.78,fadeEnd=CLOUD_HALF*.96;
   const fade=dist<=fadeStart?1:dist>=fadeEnd?0:1-(dist-fadeStart)/Math.max(1,fadeEnd-fadeStart);
   cloud.group.position.set(x,cloud.altitude+Math.sin(this.elapsed*cloud.wobble+cloud.bob)*1.5,z);
   const opacity=fade*fade*(3-2*fade)*(.80+.07*Math.sin(this.elapsed*.32+cloud.phase));
   for(const sprite of cloud.sprites)sprite.material.opacity=opacity;
  }
 }
 dispose(){this.scene.remove(this.root);for(const cloud of this.clouds)for(const sprite of cloud.sprites)sprite.material.dispose();this.texture.dispose();}
}
