import * as THREE from 'three/webgpu';

/** Визуальные эффекты наведения, предпросмотра размещения и частиц. */
export class Effects {
  constructor(scene) {
    this.scene = scene;
    const edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.008, 1.008, 1.008));
    this.highlight = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: '#fff7c8', transparent: true, opacity: 0.93, depthTest: true }));
    this.highlight.visible = false;
    scene.add(this.highlight);
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(0.997, 0.997, 0.997), new THREE.MeshBasicMaterial({ color: '#d7ffd3', transparent: true, opacity: 0.22, depthWrite: false }));
    this.ghost.visible = false;
    scene.add(this.ghost);
    const geo = new THREE.BoxGeometry(0.095, 0.095, 0.095);
    const mat = new THREE.MeshLambertMaterial({ color: '#9fc87a' });
    this.sparks = new THREE.InstancedMesh(geo, mat, 128);
    this.sparks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sparks.frustumCulled = false;
    this.sparks.count = 128;
    this.pool = Array(128).fill(null);
    this.tmp = new THREE.Object3D();
    this.tmp.scale.setScalar(0);
    for (let i = 0; i < this.pool.length; i++) {
      this.tmp.updateMatrix();
      this.sparks.setMatrixAt(i, this.tmp.matrix);
    }
    this.sparks.instanceMatrix.needsUpdate = true;
    scene.add(this.sparks);
  }

  setTarget(target, canPlace = false) {
    this.highlight.visible = Boolean(target);
    this.ghost.visible = Boolean(target && canPlace);
    if (!target) return;
    this.highlight.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
    if (canPlace) {
      const { x, y, z, normal } = target;
      this.ghost.position.set(x + normal.x + 0.5, y + normal.y + 0.5, z + normal.z + 0.5);
    }
  }

  spawn(x, y, z, amount = 17) {
    for (let j = 0; j < amount; j++) {
      const index = this.pool.findIndex((p) => !p);
      if (index < 0) break;
      this.pool[index] = {
        x: x + 0.2 + Math.random() * 0.6, y: y + 0.2 + Math.random() * 0.6, z: z + 0.2 + Math.random() * 0.6,
        vx: (Math.random() - 0.5) * 4, vy: Math.random() * 3 + 1,
        vz: (Math.random() - 0.5) * 4, life: 0.52 + Math.random() * 0.35,
        size: 0.55 + Math.random() * 1.2
      };
    }
  }

  update(dt) {
    let dirty = false;
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      if (!p) continue;
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vy -= 13 * dt;
      if (p.life <= 0) this.pool[i] = null;
      this.tmp.position.set(p.x, p.y, p.z);
      this.tmp.rotation.set(p.life * 7, p.life * 9, 0);
      this.tmp.scale.setScalar(p.life > 0 ? p.size * Math.min(1, p.life * 3) : 0);
      this.tmp.updateMatrix();
      this.sparks.setMatrixAt(i, this.tmp.matrix);
      dirty = true;
    }
    if (dirty) this.sparks.instanceMatrix.needsUpdate = true;
  }
}
