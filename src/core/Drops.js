import * as THREE from 'three/webgpu';
import { BLOCK_ITEMS, MIN_WORLD_Y } from './Terrain.js';

/** Выброшенные предметы — физические кубики, подбираемые при сближении. */
export class Drops {
  constructor(scene, world, inventory, savedItems = null) {
    this.world=world;this.inventory=inventory;this.items=[];
    if(Array.isArray(savedItems)) {
      for(const item of savedItems.slice(0,80)) {
        if(!Object.hasOwn(BLOCK_ITEMS,item?.id)||!Number.isFinite(item.x)||!Number.isFinite(item.y)||!Number.isFinite(item.z)||!Number.isInteger(item.count)||item.count<=0)continue;
        this.items.push({id:item.id,count:Math.min(64,item.count),x:item.x,y:item.y,z:item.z,vx:0,vy:0,vz:0,age:3,phase:Math.random()*Math.PI*2});
      }
    }
    this.mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(.28,.28,.28),new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.85}),96);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.mesh.frustumCulled=false;this.mesh.count=0;
    scene.add(this.mesh);this.dummy=new THREE.Object3D();this.elapsed=0;
  }
  toJSON(){return this.items.map(it=>({id:it.id,count:it.count,x:it.x,y:it.y,z:it.z}));}
  spawnAt(x,y,z,count=1,id='grass') {
    if(!Object.hasOwn(BLOCK_ITEMS,id)||this.items.length>=96)return false;
    this.items.push({id,count,x,y,z,vx:0,vy:1.7,vz:0,age:0,phase:Math.random()*Math.PI*2});return true;
  }
  throwFrom(slotIndex,all,position,direction) {
    if(this.items.length>=96)return false;
    const slot=this.inventory.get(slotIndex);if(!slot)return false;
    const stack=this.inventory.take(slotIndex,all?slot.count:1);if(!stack)return false;
    this.items.push({id:stack.id,count:stack.count,x:position.x+direction.x*.65,y:position.y-.32+direction.y*.6,z:position.z+direction.z*.65,
      vx:direction.x*2.6,vy:2.4+direction.y,vz:direction.z*2.6,age:0,phase:Math.random()*Math.PI*2});return true;
  }
  update(dt,player) {
    this.elapsed+=dt;
    for(let i=this.items.length-1;i>=0;i--) {
      const item=this.items[i];item.age+=dt;
      const wet=this.world.water?.pointDepth(item.x,item.y,item.z)>0;
      if(wet){item.vy+=(.8-item.vy)*Math.min(1,dt*5);item.vx*=Math.exp(-dt*2);item.vz*=Math.exp(-dt*2);}else item.vy-=17*dt;
      const oldX=item.x,oldZ=item.z;
      item.x+=item.vx*dt;item.z+=item.vz*dt;item.y+=item.vy*dt;
      const bx=Math.floor(item.x),by=Math.floor(item.y-.12),bz=Math.floor(item.z);
      if(this.world.hasBlock(bx,by,bz)&&item.vy<0){item.y=by+1+.16;item.vy=0;item.vx*=Math.max(0,1-8*dt);item.vz*=Math.max(0,1-8*dt);}
      if(this.world.hasBlock(Math.floor(item.x),Math.floor(item.y),Math.floor(item.z))){item.x=oldX;item.z=oldZ;item.vx*=-.25;item.vz*=-.25;}
      if(item.age>.85 && Math.hypot(item.x-player.position.x,item.y-player.position.y-.9,item.z-player.position.z)<1.55) {
        const accepted=this.inventory.add(item.id,item.count);item.count-=accepted;
        if(item.count<=0){this.items.splice(i,1);continue;}
      }
      if(item.y<MIN_WORLD_Y-12)this.items.splice(i,1);
    }
    this.mesh.count=this.items.length;
    for(let i=0;i<this.items.length;i++){
      const it=this.items[i];this.dummy.position.set(it.x,it.y+Math.sin(this.elapsed*3+it.phase)*.055,it.z);
      this.dummy.rotation.set(.15,this.elapsed*1.1+it.phase,.12);this.dummy.scale.setScalar(1);this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i,this.dummy.matrix);this.mesh.setColorAt(i,new THREE.Color(it.id==='grass'?'#8dc36b':it.id==='dirt'?'#9e7750':'#88837b'));
    }
    if(this.items.length){this.mesh.instanceMatrix.needsUpdate=true;if(this.mesh.instanceColor)this.mesh.instanceColor.needsUpdate=true;}
  }
}
