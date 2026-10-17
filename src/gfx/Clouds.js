import * as THREE from 'three/webgpu';

export const CLOUD_QUALITY = Object.freeze({
  off: { count: 0 },
  low: { count: 18 },
  medium: { count: 30 },
  high: { count: 42 },
  ultra: { count: 56 }
});

const CLOUD_SPAN = 2400;
const CLOUD_HALF = CLOUD_SPAN / 2;
const CLOUD_BASE_HEIGHT = 152;
const CLOUD_ALTITUDE_BAND = 56;
const MAX_CLOUDS = 56;

function wrapAround(value, center, span) {
  const half = span * 0.5;
  while (value < center - half) value += span;
  while (value > center + half) value -= span;
  return value;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCloudTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const rng = mulberry32(170621);
  for (let i = 0; i < 18; i++) {
    const x = size * (0.16 + rng() * 0.68);
    const y = size * (0.24 + rng() * 0.42);
    const r = size * (0.10 + rng() * 0.16);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.96)');
    g.addColorStop(0.44, 'rgba(255,255,255,0.76)');
    g.addColorStop(0.74, 'rgba(255,255,255,0.28)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const shadow = ctx.createLinearGradient(0, size * 0.32, 0, size);
  shadow.addColorStop(0, 'rgba(255,255,255,0)');
  shadow.addColorStop(0.7, 'rgba(150,166,185,0.15)');
  shadow.addColorStop(1, 'rgba(113,133,154,0.28)');
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = shadow;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  return texture;
}

export class Clouds {
  constructor(scene, camera, sunDirection) {
    this.scene = scene;
    this.camera = camera;
    this.direction = sunDirection;
    this.quality = 'high';
    this.speed = 1;
    this.elapsed = 0;
    this.clouds = [];
    this.texture = makeCloudTexture();
    this.root = new THREE.Group();
    this.root.name = 'verdant-clouds';
    this.root.renderOrder = -95;
    this.root.frustumCulled = false;
    scene.add(this.root);

    const rng = mulberry32(91357);
    const sunFacing = Math.max(0.15, Math.min(1, sunDirection.y * 0.9 + 0.55));
    const bright = new THREE.Color('#ffffff');
    const warm = new THREE.Color('#fff2d8');
    const shadow = new THREE.Color('#b8c8d6');
    for (let i = 0; i < MAX_CLOUDS; i++) {
      const group = new THREE.Group();
      group.frustumCulled = false;
      const puffCount = 3 + Math.floor(rng() * 4);
      const width = 54 + rng() * 118;
      const depth = 20 + rng() * 34;
      const altitude = CLOUD_BASE_HEIGHT + rng() * CLOUD_ALTITUDE_BAND;
      const sprites = [];
      for (let j = 0; j < puffCount; j++) {
        const mat = new THREE.SpriteMaterial({
          map: this.texture,
          transparent: true,
          depthWrite: false,
          depthTest: true,
          fog: false,
          opacity: 0.78,
          color: bright.clone().lerp(warm, 0.25 + 0.35 * rng()).lerp(shadow, 0.18 * (j / Math.max(1, puffCount - 1)))
        });
        const sprite = new THREE.Sprite(mat);
        const sx = width * (0.34 + rng() * 0.52);
        const sy = sx * (0.36 + rng() * 0.16);
        sprite.scale.set(sx, sy, 1);
        sprite.position.set(
          (rng() - 0.5) * width,
          (rng() - 0.5) * depth,
          (rng() - 0.5) * 10
        );
        sprite.material.opacity *= 0.84 + 0.12 * sunFacing;
        group.add(sprite);
        sprites.push(sprite);
      }
      const record = {
        group,
        baseX: (rng() - 0.5) * CLOUD_SPAN,
        baseZ: (rng() - 0.5) * CLOUD_SPAN,
        driftX: 3.2 + rng() * 6.4,
        driftZ: 0.7 + rng() * 2.2,
        altitude,
        bob: rng() * Math.PI * 2,
        phase: rng() * Math.PI * 2,
        wobble: 0.8 + rng() * 1.6,
        sprites
      };
      group.visible = false;
      this.root.add(group);
      this.clouds.push(record);
    }
    this.setQuality('high');
  }

  setQuality(mode) {
    this.quality = Object.hasOwn(CLOUD_QUALITY, mode) ? mode : 'high';
    const limit = CLOUD_QUALITY[this.quality].count;
    this.root.visible = limit > 0;
    this.clouds.forEach((cloud, index) => { cloud.group.visible = index < limit; });
  }

  setSpeed(value) { this.speed = Math.max(0, Math.min(3, value)); }

  update(dt) {
    this.elapsed += dt * this.speed;
    if (!this.root.visible) return;
    const cameraX = this.camera.position.x;
    const cameraZ = this.camera.position.z;
    for (const cloud of this.clouds) {
      if (!cloud.group.visible) continue;
      const x = wrapAround(cameraX + cloud.baseX + this.elapsed * cloud.driftX, cameraX, CLOUD_SPAN);
      const z = wrapAround(cameraZ + cloud.baseZ + this.elapsed * cloud.driftZ, cameraZ, CLOUD_SPAN);
      const dx = x - cameraX;
      const dz = z - cameraZ;
      const dist = Math.hypot(dx, dz);
      const fadeStart = CLOUD_HALF * 0.78;
      const fadeEnd = CLOUD_HALF * 0.96;
      const fade = dist <= fadeStart ? 1 : dist >= fadeEnd ? 0 : 1 - (dist - fadeStart) / Math.max(1, fadeEnd - fadeStart);
      cloud.group.position.set(x, cloud.altitude + Math.sin(this.elapsed * cloud.wobble + cloud.bob) * 1.5, z);
      const opacity = fade * (0.80 + 0.07 * Math.sin(this.elapsed * 0.32 + cloud.phase));
      for (const sprite of cloud.sprites) sprite.material.opacity = opacity;
    }
  }

  dispose() {
    this.scene.remove(this.root);
    for (const cloud of this.clouds) {
      for (const sprite of cloud.sprites) sprite.material.dispose();
    }
    this.texture.dispose();
  }
}
