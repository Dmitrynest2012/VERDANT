import { MAX_WORLD_Y } from './Terrain.js';
/**
 * Геометрия коллизий и векторы движения без зависимости от рендера.
 * Координата position.y — СТУПНИ, не центр капсулы: это важное соглашение.
 */
export const PLAYER_RADIUS = 0.29;
export const PLAYER_HEIGHT = 1.78;
export const CROUCH_HEIGHT = 1.35;
export const CONTACT_EPS = 0.00025;

/** WASD строго в горизонтальной плоскости относительно направления камеры. */
export function inputDirection(yaw, forward, strafe) {
  const length = Math.hypot(forward, strafe);
  if (!length) return { x: 0, z: 0 };
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  return {
    x: ((-sin * forward + cos * strafe) / length) || 0,
    z: ((-cos * forward - sin * strafe) / length) || 0
  };
}

/** Проверить пересечение AABB персонажа с воксельным миром. */
export function isSpaceClear(world, p, height = PLAYER_HEIGHT) {
  const xmin = Math.floor(p.x - PLAYER_RADIUS + CONTACT_EPS);
  const xmax = Math.floor(p.x + PLAYER_RADIUS - CONTACT_EPS);
  const ymin = Math.floor(p.y + CONTACT_EPS);
  const ymax = Math.floor(p.y + height - CONTACT_EPS);
  const zmin = Math.floor(p.z - PLAYER_RADIUS + CONTACT_EPS);
  const zmax = Math.floor(p.z + PLAYER_RADIUS - CONTACT_EPS);
  for (let x = xmin; x <= xmax; x++) {
    for (let y = ymin; y <= ymax; y++) {
      for (let z = zmin; z <= zmax; z++) {
        if (world.hasBlock(x, y, z)) return false;
      }
    }
  }
  return true;
}

/** Пересекается ли текущий прямоугольник персонажа с конкретным блоком. */
export function playerIntersectsBlock(position, height, x, y, z) {
  return position.x + PLAYER_RADIUS > x + CONTACT_EPS &&
    position.x - PLAYER_RADIUS < x + 1 - CONTACT_EPS &&
    position.y + height > y + CONTACT_EPS && position.y < y + 1 - CONTACT_EPS &&
    position.z + PLAYER_RADIUS > z + CONTACT_EPS &&
    position.z - PLAYER_RADIUS < z + 1 - CONTACT_EPS;
}

/**
 * Непрерывное перемещение вдоль одной оси, с выбором БЛИЖАЙШЕЙ грани.
 * Проверяется весь swept AABB от старой до новой точки, а не только конечная
 * позиция. Это предотвращает тоннелирование при низком FPS/высокой скорости.
 * Положительные Y: потолок касается МАКУШКИ; отрицательные Y: пол касается СТУПНЕЙ.
 */
export function sweepAxis(world, position, velocity, height, axis, displacement) {
  if (!Number.isFinite(displacement) || displacement === 0) return false;
  const old = position[axis];
  const newPosition = old + displacement;
  const ext = (axis === 'y') ? [0, height] : [-PLAYER_RADIUS, PLAYER_RADIUS];
  const oldLow = old + ext[0], oldHigh = old + ext[1];
  const newLow = newPosition + ext[0], newHigh = newPosition + ext[1];
  const swept = {
    x: [position.x - PLAYER_RADIUS, position.x + PLAYER_RADIUS],
    y: [position.y, position.y + height],
    z: [position.z - PLAYER_RADIUS, position.z + PLAYER_RADIUS]
  };
  swept[axis] = [Math.min(oldLow, newLow), Math.max(oldHigh, newHigh)];
  const xmin = Math.floor(swept.x[0] + CONTACT_EPS);
  const xmax = Math.floor(swept.x[1] - CONTACT_EPS);
  const ymin = Math.floor(swept.y[0] + CONTACT_EPS);
  const ymax = Math.floor(swept.y[1] - CONTACT_EPS);
  const zmin = Math.floor(swept.z[0] + CONTACT_EPS);
  const zmax = Math.floor(swept.z[1] - CONTACT_EPS);
  let next = newPosition;
  let hit = false;
  for (let x = xmin; x <= xmax; x++) {
    for (let y = ymin; y <= ymax; y++) {
      for (let z = zmin; z <= zmax; z++) {
        if (!world.hasBlock(x, y, z)) continue;
        const voxel = axis === 'x' ? x : axis === 'y' ? y : z;
        if (displacement > 0) {
          // Персонаж двигался к нижней грани блока с отрицательной стороны.
          if (oldHigh <= voxel + CONTACT_EPS && newHigh > voxel) {
            next = Math.min(next, voxel - ext[1] - CONTACT_EPS);
            hit = true;
          }
        } else {
          // При движении вниз ограничивает y+1, НЕ y+1-height.
          if (oldLow >= voxel + 1 - CONTACT_EPS && newLow < voxel + 1) {
            next = Math.max(next, voxel + 1 - ext[0] + CONTACT_EPS);
            hit = true;
          }
        }
      }
    }
  }
  position[axis] = next;
  if (hit) velocity[axis] = 0;
  return hit;
}

/**
 * Если старое (ошибочное) сохранение поместило персонажа ВНУТРЬ грунта,
 * поднять его на верхний доступный безопасный уровень с сохранением X/Z.
 */
export function recoverPosition(world, p, height = PLAYER_HEIGHT) {
  const chosen = { x: p.x, y: p.y, z: p.z };
  if (isSpaceClear(world, chosen, height)) return { position: chosen, recovered: false };
  const span = PLAYER_RADIUS;
  let top = 0;
  for (let x = Math.floor(p.x - span); x <= Math.floor(p.x + span); x++) {
    for (let z = Math.floor(p.z - span); z <= Math.floor(p.z + span); z++) {
      top = Math.max(top, world.heightAt(x + 0.5, z + 0.5));
    }
  }
  for (let y = Math.max(p.y, top + CONTACT_EPS); y <= Math.max(MAX_WORLD_Y + 3, top + height + 4); y += 1) {
    chosen.y = y;
    if (isSpaceClear(world, chosen, height)) return { position: chosen, recovered: true };
  }
  chosen.x = chosen.z = 0.5;
  chosen.y = world.heightAt(0.5, 0.5) + CONTACT_EPS;
  return { position: chosen, recovered: true };
}
