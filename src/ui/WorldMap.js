import { MAP_DIAMETERS, MAP_PIXEL_SIZE, clampMapLevel, mapWorldPosition, sampleMapPixel } from '../core/MapSampling.js';

/**
 * Пиксельная топографическая карта. Обновляется прогрессивно: сперва грубый
 * предварительный слой, затем 2× уточнение и только потом финальная детализация.
 * Это делает смену зума визуально отзывчивой и уменьшает подвисания.
 */
export class WorldMap {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d', { alpha: false, willReadFrequently: false });
    this.world = world;
    this.size = MAP_PIXEL_SIZE;
    this.canvas.width = this.canvas.height = this.size;
    this.level = 0;
    this.targetDiameter = MAP_DIAMETERS[0];
    this.diameter = MAP_DIAMETERS[0];
    this.center = { x: 0, z: 0 };
    this.job = null;
    this.lastDraw = -Infinity;
    this.hadFullDraw = false;
    this.overlay = document.getElementById('map-heading');
    this.coordLabel = document.getElementById('map-location');
    this.rangeLabel = document.getElementById('map-range');
    this.controls = [...document.querySelectorAll('[data-map-level]')];
  }

  activate(player) {
    this.center.x = player.position.x;
    this.center.z = player.position.z;
    this.invalidate();
  }
  invalidate() { this.job = null; this.hadFullDraw = false; this.lastDraw = -Infinity; }

  setLevel(index) {
    this.level = clampMapLevel(index);
    this.targetDiameter = MAP_DIAMETERS[this.level];
    this.controls.forEach((item) => item.classList.toggle('active', Number(item.dataset.mapLevel) === this.level));
    if (this.overlay) this.overlay.textContent = `КАРТА · ${MAP_DIAMETERS[this.level]} М`;
  }

  zoom(delta) { this.setLevel(this.level + delta); }

  makeJob() {
    return {
      image: this.context.createImageData(this.size, this.size),
      centerX: this.center.x,
      centerZ: this.center.z,
      diameter: this.diameter,
      row: 0,
      pass: 0,
      stride: 4
    };
  }

  fillBlock(job, col, row, stride, color) {
    const px = this.size;
    const data = job.image.data;
    const maxRow = Math.min(px, row + stride);
    const maxCol = Math.min(px, col + stride);
    for (let y = row; y < maxRow; y++) {
      for (let x = col; x < maxCol; x++) {
        const offset = (y * px + x) * 4;
        data[offset] = color[0]; data[offset + 1] = color[1];
        data[offset + 2] = color[2]; data[offset + 3] = 255;
      }
    }
  }

  drawMarker(x, z, yaw, diameter) {
    const ctx = this.context;
    const mid = this.size / 2;
    ctx.save();
    ctx.translate(mid, mid);
    ctx.rotate(-yaw);
    ctx.fillStyle = '#ecf8ff';
    ctx.strokeStyle = '#183745';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(-7, 9);
    ctx.lineTo(0, 5);
    ctx.lineTo(7, 9);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#e3f4ff';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('N', mid - 3, 15);
    ctx.fillText('S', mid - 3, this.size - 11);
    const barMeters = diameter >= 800 ? 200 : diameter >= 400 ? 100 : 50;
    const barLength = barMeters / diameter * this.size;
    ctx.strokeStyle = '#ecf6ff';
    ctx.lineWidth = 2;
    const y = this.size - 19;
    ctx.beginPath();
    ctx.moveTo(17, y); ctx.lineTo(17 + barLength, y);
    ctx.moveTo(17, y - 4); ctx.lineTo(17, y + 4);
    ctx.moveTo(17 + barLength, y - 4); ctx.lineTo(17 + barLength, y + 4);
    ctx.stroke();
    ctx.font = '10px sans-serif';
    ctx.fillText(`${barMeters} м`, 17, y - 7);
  }

  update(dt, player, active) {
    if (!active) return;
    const p = player.position;
    this.center.x = p.x; this.center.z = p.z;
    const eased = 1 - Math.exp(-Math.max(0, dt) * 7);
    const oldDiameter = this.diameter;
    this.diameter += (this.targetDiameter - this.diameter) * eased;
    if (Math.abs(this.targetDiameter - this.diameter) < 0.12) this.diameter = this.targetDiameter;
    const movingZoom = Math.abs(oldDiameter - this.diameter) > 0.05;

    if (!this.job && (!this.hadFullDraw || movingZoom || performance.now() - this.lastDraw > 900)) this.job = this.makeJob();
    if (!this.job) return;
    const job = this.job;
    const px = this.size;
    const rowsPerFrame = job.stride === 4 ? 22 : job.stride === 2 ? 16 : 12;
    const end = Math.min(this.size, job.row + rowsPerFrame * job.stride);
    for (let row = job.row; row < end; row += job.stride) {
      for (let col = 0; col < px; col += job.stride) {
        const pos = mapWorldPosition(col + job.stride * 0.5 - 0.5, row + job.stride * 0.5 - 0.5, px, job.centerX, job.centerZ, job.diameter);
        const color = sampleMapPixel(this.world, pos.x, pos.z, (job.diameter / px) * job.stride);
        this.fillBlock(job, col, row, job.stride, color);
      }
    }
    job.row = end;
    if (job.row >= this.size) {
      if (job.stride > 1) {
        job.pass += 1;
        job.stride = job.pass === 1 ? 2 : 1;
        job.row = 0;
      } else {
        this.context.putImageData(job.image, 0, 0);
        this.drawMarker(p.x, p.z, player.yaw, job.diameter);
        this.hadFullDraw = true;
        this.lastDraw = performance.now();
        this.job = null;
        this.rangeLabel.textContent = `Охват ${Math.round(job.diameter)} × ${Math.round(job.diameter)} м`;
        this.coordLabel.textContent = `X ${p.x.toFixed(1)}  ·  Z ${p.z.toFixed(1)}  ·  Y ${p.y.toFixed(1)} м`;
      }
    } else if (job.pass === 0 && job.row >= this.size * 0.25) {
      this.context.putImageData(job.image, 0, 0);
      this.drawMarker(p.x, p.z, player.yaw, job.diameter);
    }
  }
}
