import test from 'node:test';
import assert from 'node:assert/strict';
import { Inventory, SLOT_COUNT, STACK_MAX } from '../src/core/Inventory.js';

function total(inv) {
  return inv.slots.reduce((n, s) => n + (s?.count || 0), 0) + (inv.held?.count || 0);
}

test('Первое появление: 36 слотов, 32 блока на панели', () => {
  const inv = new Inventory();
  assert.equal(inv.slots.length, SLOT_COUNT);
  assert.deepEqual(inv.get(0), { id: 'grass', count: 32 });
  assert.equal(total(inv), 32);
});

test('Разделение ПКМ на 16/16, по одному предмету, восстановление стаков', () => {
  const inv = new Inventory();
  inv.rightClick(0);
  assert.equal(inv.held.count, 16);
  assert.equal(inv.get(0).count, 16);
  inv.rightClick(1);
  assert.equal(inv.get(1).count, 1);
  assert.equal(inv.held.count, 15);
  inv.leftClick(0);
  assert.equal(inv.get(0).count, 31);
  assert.equal(inv.held, null);
  assert.equal(total(inv), 32);
});

test('Объединение в стаки по 64 и корректное переполнение', () => {
  const inv = new Inventory(Array(SLOT_COUNT).fill(null));
  assert.equal(inv.add('grass', STACK_MAX * SLOT_COUNT + 99), STACK_MAX * SLOT_COUNT);
  assert.equal(inv.add('grass', 2), 0);
  assert.equal(inv.take(10, 11).count, 11);
  assert.equal(inv.add('grass', 12), 11);
  assert.equal(total(inv), STACK_MAX * SLOT_COUNT);
});

test('Shift+ЛКМ перемещает из рюкзака на панель и обратно', () => {
  const inv = new Inventory();
  assert.equal(inv.quickMove(0), true);
  assert.equal(inv.get(0), null);
  assert.equal(inv.get(9).count, 32);
  assert.equal(inv.quickMove(9), true);
  assert.equal(inv.get(0).count, 32);
  assert.equal(inv.get(9), null);
});

test('Отложенную на курсоре стопку не теряем при закрытии', () => {
  const inv = new Inventory();
  inv.leftClick(0);
  assert.equal(inv.get(0), null);
  assert.equal(total(inv), 32);
  assert.equal(inv.returnHeld(), true);
  assert.equal(inv.held, null);
  assert.equal(total(inv), 32);
});

test('Бесполезный id и битые сохранения отбрасываются', () => {
  const inv = new Inventory([{ id: 'invalid', count: 9 }, { id: 'grass', count: 1000 }]);
  assert.equal(inv.get(0), null);
  assert.equal(inv.get(1).count, 64);
  assert.equal(inv.add('invalid', 4), 0);
});


test('Три типа блоков — отдельные стаки, перемещение и сохранение без потерь',()=>{
  const inv=new Inventory(Array(SLOT_COUNT).fill(null));
  assert.equal(inv.add('dirt',70),70);
  assert.equal(inv.add('rocky_dirt',8),8);
  assert.equal(inv.add('grass',5),5);
  assert.deepEqual(inv.get(0),{id:'dirt',count:64});
  assert.deepEqual(inv.get(1),{id:'dirt',count:6});
  assert.deepEqual(inv.get(2),{id:'rocky_dirt',count:8});
  assert.deepEqual(new Inventory(inv.toJSON()).toJSON(),inv.toJSON());
});
