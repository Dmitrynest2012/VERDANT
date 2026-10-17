import { immersion, stepSwimming } from './SwimPhysics.js';
import { MIN_WORLD_Y, MAX_WORLD_Y, WORLD_HALF } from './Terrain.js';
import * as THREE from 'three/webgpu';
import {
  PLAYER_HEIGHT, CROUCH_HEIGHT, CONTACT_EPS, inputDirection,
  isSpaceClear, playerIntersectsBlock, sweepAxis, recoverPosition
} from './PlayerPhysics.js';

const GRAVITY = -25.5;
const FIXED_STEP = 1 / 120;

/**
 * Персонаж FPP: ноги заданы position.y, движение X/Z/Y с непрерывными
 * столкновениями. Физика не зависит от чанкового меша, UV и графического API.
 */
export class Player {
  constructor(world, camera, saved = null) {
    this.world = world;
    this.camera = camera;
    const spawnY = world.heightAt(0.5, 0.5) + 0.10;
    const p = saved?.position;
    const intended = {
      x: Number.isFinite(p?.x) && Math.abs(p.x) < WORLD_HALF - 1 ? p.x : 0.5,
      y: Number.isFinite(p?.y) && p.y > MIN_WORLD_Y - 12 && p.y < MAX_WORLD_Y + 12 ? p.y : spawnY,
      z: Number.isFinite(p?.z) && Math.abs(p.z) < WORLD_HALF - 1 ? p.z : 0.5
    };
    const recovered = recoverPosition(world, intended);
    this.recoveredFromSave = recovered.recovered;
    this.position = new THREE.Vector3(recovered.position.x, recovered.position.y, recovered.position.z);
    this.velocity = new THREE.Vector3();
    this.yaw = Number.isFinite(saved?.yaw) ? saved.yaw : -0.75;
    this.pitch = Number.isFinite(saved?.pitch) ? THREE.MathUtils.clamp(saved.pitch, -1.54, 1.54) : -0.06;
    this.height = PLAYER_HEIGHT;
    this.eyeHeight = 1.62;
    this.isCrouched = false;
    this.inWater=false;this.submerged=false;this.waterDepth=0;
    this.onGround = false;
    this.jumpBuffer = 0;
    this.coyote = 0;
    this.accumulator = 0;
    this.walkTime = 0;
    this.updateCamera(0);
  }

  look(movementX, movementY) {
    this.yaw -= movementX * 0.0023;
    this.pitch = THREE.MathUtils.clamp(this.pitch - movementY * 0.0023, -Math.PI * 0.492, Math.PI * 0.492);
    this.updateCamera(0);
  }

  queueJump() { this.jumpBuffer = 0.15; }

  update(dt, pressed, active) {
    if (!active) {
      this.accumulator = 0;
      this.updateCamera(0);
      return;
    }
    this.accumulator += Math.min(Math.max(dt, 0), 0.075);
    let steps = 0;
    while (this.accumulator >= FIXED_STEP && steps < 12) {
      this.step(FIXED_STEP, pressed);
      this.accumulator -= FIXED_STEP;
      steps++;
    }
    this.updateCamera(dt);
  }

  step(dt, pressed) {
    this.inWater=immersion(this.world.water,this.position,this.height)>=.39;
    this.waterDepth=this.world.water?.pointDepth(this.position.x,this.position.y+this.eyeHeight,this.position.z)||0;
    this.submerged=this.waterDepth>.035;
    if(this.inWater) {
      this.isCrouched=!isSpaceClear(this.world,this.position,PLAYER_HEIGHT);
      this.height=this.isCrouched?CROUCH_HEIGHT:PLAYER_HEIGHT;
      stepSwimming(this,this.world,this.world.water,dt,pressed);
      return;
    }
    const crouchRequested = pressed.has('ControlLeft') || pressed.has('ControlRight');
    this.isCrouched = crouchRequested || !isSpaceClear(this.world, this.position, PLAYER_HEIGHT);
    this.height = this.isCrouched ? CROUCH_HEIGHT : PLAYER_HEIGHT;
    const forward = Number(pressed.has('KeyW')) - Number(pressed.has('KeyS'));
    const strafe = Number(pressed.has('KeyD')) - Number(pressed.has('KeyA'));
    const sprinting = !this.isCrouched && (pressed.has('ShiftLeft') || pressed.has('ShiftRight')) && forward > 0;
    const speed = this.isCrouched ? 2.2 : sprinting ? 6.6 : 4.3;
    const direction = inputDirection(this.yaw, forward, strafe);
    const rate = this.onGround ? 23 : 7;
    const alpha = 1 - Math.exp(-rate * dt);
    this.velocity.x += (direction.x * speed - this.velocity.x) * alpha;
    this.velocity.z += (direction.z * speed - this.velocity.z) * alpha;

    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.coyote = this.onGround ? 0.10 : Math.max(0, this.coyote - dt);
    if (this.jumpBuffer > 0 && this.coyote > 0 && !this.isCrouched) {
      this.velocity.y = 8.7;
      this.onGround = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
    }
    this.velocity.y = Math.max(-39, this.velocity.y + GRAVITY * dt);

    sweepAxis(this.world, this.position, this.velocity, this.height, 'x', this.velocity.x * dt);
    sweepAxis(this.world, this.position, this.velocity, this.height, 'z', this.velocity.z * dt);
    const verticalMotion = this.velocity.y * dt;
    const verticalHit = sweepAxis(this.world, this.position, this.velocity, this.height, 'y', verticalMotion);
    this.onGround = verticalHit && verticalMotion < 0;
    if (this.position.y < MIN_WORLD_Y - 12) this.respawn();
    if (Math.hypot(this.velocity.x, this.velocity.z) > 0.7 && this.onGround) {
      this.walkTime += dt * (sprinting ? 12 : 9);
    }
  }

  canOccupy(height) { return isSpaceClear(this.world, this.position, height); }
  intersectsBlock(x, y, z) { return playerIntersectsBlock(this.position, this.height, x, y, z); }

  respawn() {
    this.position.set(0.5, this.world.heightAt(0.5, 0.5) + CONTACT_EPS, 0.5);
    this.velocity.set(0, 0, 0);
    this.onGround = false;
  }

  updateCamera(dt) {
    const want = this.isCrouched ? 1.16 : 1.62;
    this.eyeHeight += (want - this.eyeHeight) * Math.min(1, dt * 12);
    const horizontal = Math.hypot(this.velocity.x, this.velocity.z);
    const bob = (this.onGround && !this.inWater) ? Math.sin(this.walkTime) * Math.min(0.027, horizontal * 0.005) : 0;
    this.camera.position.set(this.position.x, this.position.y + this.eyeHeight + bob, this.position.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }

  toJSON() {
    return { position: { x: this.position.x, y: this.position.y, z: this.position.z }, yaw: this.yaw, pitch: this.pitch };
  }
}
