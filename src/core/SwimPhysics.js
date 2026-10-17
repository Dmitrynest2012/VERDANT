import { sweepAxis, isSpaceClear } from './PlayerPhysics.js';

export const SWIM_SPEED = 2.7;
export const FAST_SWIM_SPEED = 4.3;
/** Нормализованное управление в 3D: диагональ и Space+W не дают сверхскорости. */
export function swimDirection(yaw,pitch,forward,strafe,vertical) {
  const sin=Math.sin(yaw),cos=Math.cos(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
  const d={x:-sin*cp*forward+cos*strafe,y:sp*forward+vertical,z:-cos*cp*forward-sin*strafe};
  const n=Math.max(1,Math.hypot(d.x,d.y,d.z));
  d.x/=n; d.y/=n; d.z/=n; return d;
}
export function immersion(water,p,height=1.78) {
  if (!water) return 0;
  let total=0;
  for(const h of [.12,.5,.9,1.3,1.65]) total += water.pointDepth(p.x,p.y+Math.min(height-.05,h),p.z)>0 ? .2:0;
  return total;
}
/** Плавание использует ту же swept-AABB коллизию, что и ходьба. */
export function stepSwimming(body,world,water,dt,keys) {
  const forward=Number(keys.has('KeyW'))-Number(keys.has('KeyS'));
  const strafe=Number(keys.has('KeyD'))-Number(keys.has('KeyA'));
  const up=Number(keys.has('Space')), down=Number(keys.has('ControlLeft')||keys.has('ControlRight'));
  const direction=swimDirection(body.yaw,body.pitch,forward,strafe,up-down);
  const speed=(keys.has('ShiftLeft')||keys.has('ShiftRight')) ? FAST_SWIM_SPEED : SWIM_SPEED;
  const a=1-Math.exp(-5.5*dt),v=body.velocity;
  // Без клавиш — очень медленное погружение, не резкое падение наземной гравитации.
  v.x+=(direction.x*speed-v.x)*a;
  v.z+=(direction.z*speed-v.z)*a;
  v.y+=(direction.y*speed-(up||down?0:.18)-v.y)*a;
  v.y=Math.max(-5,Math.min(5,v.y));
  const p=body.position, oldX=p.x,oldZ=p.z;
  const hitX=sweepAxis(world,p,v,body.height,'x',v.x*dt);
  const hitZ=sweepAxis(world,p,v,body.height,'z',v.z*dt);
  // У берега Space позволяет выбраться через ступень высотой до одного блока.
  if(up && (hitX||hitZ) && water.pointDepth(p.x,p.y+body.height-.08,p.z)<.35) {
    const raised={x:oldX+direction.x*.15,y:p.y+1.05,z:oldZ+direction.z*.15};
    if(isSpaceClear(world,raised,body.height)) {p.x=raised.x;p.y=raised.y;p.z=raised.z;v.y=1.5;}
  }
  const dy=v.y*dt, hitY=sweepAxis(world,p,v,body.height,'y',dy);
  body.onGround=hitY&&dy<0;
  body.jumpBuffer=0;body.coyote=0;
}
