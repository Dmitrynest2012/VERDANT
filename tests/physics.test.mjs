import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAYER_HEIGHT, PLAYER_RADIUS, CONTACT_EPS, inputDirection,
  sweepAxis, isSpaceClear, recoverPosition, playerIntersectsBlock
} from '../src/core/PlayerPhysics.js';

const blocks = (...coordinates) => {
  const map = new Set(coordinates.map(([x,y,z]) => `${x},${y},${z}`));
  return {
    hasBlock: (x,y,z) => map.has(`${x},${y},${z}`),
    heightAt: (x,z) => {
      let top = 0;
      for (const key of map) {
        const [bx,by,bz] = key.split(',').map(Number);
        if (bx === Math.floor(x) && bz === Math.floor(z)) top = Math.max(top,by+1);
      }
      return top;
    }
  };
};
const at = (x,y,z) => ({x,y,z});
const v = (x=0,y=0,z=0) => ({x,y,z});

test('WASD при нулевом yaw: W на -Z, S на +Z, D на +X, A на -X', () => {
  assert.deepEqual(inputDirection(0,1,0), {x:0,z:-1});
  assert.deepEqual(inputDirection(0,-1,0), {x:0,z:1});
  assert.deepEqual(inputDirection(0,0,1), {x:1,z:0});
  assert.deepEqual(inputDirection(0,0,-1), {x:-1,z:0});
});

test('W смотрит по вектору камеры при повороте на 90°, диагональ нормализована', () => {
  const forward = inputDirection(-Math.PI/2,1,0);
  assert.ok(Math.abs(forward.x-1)<1e-10);
  assert.ok(Math.abs(forward.z)<1e-10);
  const diag = inputDirection(-0.6,1,1);
  assert.ok(Math.abs(Math.hypot(diag.x,diag.z)-1)<1e-10);
  assert.deepEqual(inputDirection(-0.6,0,0), {x:0,z:0});
});

test('Падение на пол: ступни остаются ВЫШЕ блока, не на height ниже поверхности', () => {
  const world = blocks([0,8,0]);
  const pos = at(0.5,12,0.5), vel = v(0,-30,0);
  const hit = sweepAxis(world,pos,vel,PLAYER_HEIGHT,'y',-5);
  assert.equal(hit,true);
  assert.ok(pos.y>=9 && pos.y<9.001);
  assert.equal(vel.y,0);
  assert.equal(isSpaceClear(world,pos,PLAYER_HEIGHT),true);
});

test('Столкновение с потолком: нельзя пробить верх головы', () => {
  const world = blocks([0,12,0]);
  const pos = at(0.5,9.2,0.5), vel = v(0,11,0);
  const hit = sweepAxis(world,pos,vel,PLAYER_HEIGHT,'y',2.8);
  assert.equal(hit,true);
  assert.ok(pos.y+PLAYER_HEIGHT <= 12);
  assert.equal(vel.y,0);
});

test('Стена справа: коллизия с +X и остановка без выбрасывания в стороны', () => {
  const world = blocks([1,9,0], [1,10,0]);
  const pos = at(0.5,9.01,0.5), vel = v(100,0,0);
  assert.equal(sweepAxis(world,pos,vel,PLAYER_HEIGHT,'x',3),true);
  assert.ok(pos.x+PLAYER_RADIUS<1);
  assert.equal(vel.x,0);
  assert.equal(pos.z,0.5);
});

test('Стена слева: коллизия при -X, без телепорта сквозь блок', () => {
  const world = blocks([-1,9,0],[-1,10,0]);
  const pos = at(0.5,9.01,0.5), vel = v(-80,0,0);
  assert.equal(sweepAxis(world,pos,vel,PLAYER_HEIGHT,'x',-5),true);
  assert.ok(pos.x-PLAYER_RADIUS>0);
  assert.equal(vel.x,0);
});

test('Проверка оси Z: нет бокового сноса и прохода сквозь блок', () => {
  const world = blocks([0,9,-1]);
  const pos = at(0.5,9.01,0.5), vel = v(0,0,-20);
  assert.equal(sweepAxis(world,pos,vel,PLAYER_HEIGHT,'z',-4),true);
  assert.ok(pos.z-PLAYER_RADIUS>0);
  assert.equal(pos.x,0.5);
});

test('Скольжение вдоль стены: X заблокирован, Z движется', () => {
  const world = blocks([1,9,0],[1,9,1],[1,10,0],[1,10,1]);
  const pos=at(0.5,9.001,0.5), vel=v(4,0,4);
  sweepAxis(world,pos,vel,PLAYER_HEIGHT,'x',0.4);
  sweepAxis(world,pos,vel,PLAYER_HEIGHT,'z',0.4);
  assert.ok(pos.x < 1-PLAYER_RADIUS);
  assert.ok(pos.z>0.8);
});

test('Высокая скорость и низкий FPS: sweep проверяет всю траекторию', () => {
  const world=blocks([0,8,0]);
  const pos=at(0.5,15,0.5), vel=v(0,-40,0);
  sweepAxis(world,pos,vel,PLAYER_HEIGHT,'y',-11);
  assert.ok(pos.y>9 && pos.y<9.001);
});

test('Сохранение с игроком внутри земли автоматически восстанавливает безопасную точку', () => {
  const world=blocks([0,8,0],[0,9,0]);
  const repaired=recoverPosition(world,at(0.5,8.3,0.5));
  assert.equal(repaired.recovered,true);
  assert.ok(repaired.position.y>=10);
  assert.equal(isSpaceClear(world,repaired.position),true);
});

test('Свободное корректное сохранение не теряет позицию', () => {
  const repaired=recoverPosition(blocks([0,8,0]),at(0.5,9.1,0.5));
  assert.equal(repaired.recovered,false);
  assert.equal(repaired.position.y,9.1);
});

test('Попытка установки блока в игрока отклоняется для всех сторон AABB', () => {
  const pos=at(0.5,9.001,0.5);
  assert.equal(playerIntersectsBlock(pos,PLAYER_HEIGHT,0,9,0),true);
  assert.equal(playerIntersectsBlock(pos,PLAYER_HEIGHT,1,9,0),false);
  assert.equal(playerIntersectsBlock(pos,PLAYER_HEIGHT,0,8,0),false);
});
