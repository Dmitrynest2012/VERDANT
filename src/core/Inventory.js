import { BLOCK_ITEMS } from './Terrain.js';

/** Инвентарь: 9 горячих и 27 обычных слотов; грунт и вёдра. */
export const SLOT_COUNT = 36;
export const HOTBAR_COUNT = 9;
export const STACK_MAX = 64;
export const BLOCK_ID = 'grass';
export const stackLimit = id => BLOCK_ITEMS[id]?.stackMax ?? STACK_MAX;
function validStack(stack) {
  if (!stack || !Object.hasOwn(BLOCK_ITEMS, stack.id) || !Number.isFinite(stack.count)) return null;
  const count = Math.max(0, Math.min(stackLimit(stack.id), Math.trunc(stack.count)));
  return count ? { id: stack.id, count } : null;
}
export class Inventory {
  constructor(savedSlots = null, onChange = () => {}) {
    this.slots = Array.from({ length: SLOT_COUNT }, (_, i) => validStack(savedSlots?.[i]));
    if (!savedSlots) { this.slots[0] = { id: BLOCK_ID, count: 32 }; this.slots[1] = { id: 'bucket', count: 1 }; }
    this.held = null;
    this.onChange = onChange;
  }
  notify() { this.onChange(this); }
  get(index) { return this.slots[index] ?? null; }
  toJSON() { return this.slots.map((s) => s ? { ...s } : null); }
  /** Возвращает фактически добавленное количество. */
  add(id, count) {
    if (!Object.hasOwn(BLOCK_ITEMS, id) || !Number.isFinite(count) || count < 1) return 0;
    let remaining = Math.trunc(count);
    const requested = remaining;
    for (const slot of this.slots) {
      if (slot?.id !== id || slot.count >= stackLimit(id)) continue;
      const n = Math.min(remaining, stackLimit(id) - slot.count);
      slot.count += n; remaining -= n;
      if (!remaining) break;
    }
    if (remaining) {
      for (let i = 0; i < SLOT_COUNT; i++) {
        if (this.slots[i]) continue;
        const n = Math.min(remaining, stackLimit(id));
        this.slots[i] = { id, count: n }; remaining -= n;
        if (!remaining) break;
      }
    }
    if (requested !== remaining) this.notify();
    return requested - remaining;
  }
  take(index, count = 1) {
    const slot = this.get(index);
    if (!slot || count <= 0) return null;
    const n = Math.min(slot.count, Math.trunc(count));
    if (n <= 0) return null;
    const taken = { id: slot.id, count: n };
    slot.count -= n;
    if (slot.count === 0) this.slots[index] = null;
    this.notify(); return taken;
  }
  /** ЛКМ: подхватить/поставить/объединить/обменять. */
  leftClick(index) {
    if (index < 0 || index >= SLOT_COUNT) return;
    const here = this.slots[index];
    if (!this.held) {
      if (!here) return;
      this.held = here; this.slots[index] = null;
    } else if (!here) {
      this.slots[index] = this.held; this.held = null;
    } else if (here.id === this.held.id && here.count < stackLimit(here.id)) {
      const n = Math.min(this.held.count, stackLimit(here.id) - here.count);
      here.count += n; this.held.count -= n;
      if (this.held.count === 0) this.held = null;
    } else { this.slots[index] = this.held; this.held = here; }
    this.notify();
  }
  /** ПКМ: взять половину либо положить один предмет. */
  rightClick(index) {
    if (index < 0 || index >= SLOT_COUNT) return;
    const here = this.slots[index];
    if (!this.held) {
      if (!here) return;
      const n = Math.ceil(here.count / 2);
      this.held = { id: here.id, count: n }; here.count -= n;
      if (here.count === 0) this.slots[index] = null;
    } else if (!here) {
      this.slots[index] = { id: this.held.id, count: 1 }; this.held.count--;
      if (this.held.count === 0) this.held = null;
    } else if (here.id === this.held.id && here.count < stackLimit(here.id)) {
      here.count++; this.held.count--;
      if (this.held.count === 0) this.held = null;
    } else return;
    this.notify();
  }
  /** Shift + ЛКМ: горячая панель ↔ рюкзак. */
  quickMove(index) {
    if (index < 0 || index >= SLOT_COUNT || this.held) return false;
    const source = this.slots[index];
    if (!source) return false;
    const start = index < HOTBAR_COUNT ? HOTBAR_COUNT : 0;
    const end = index < HOTBAR_COUNT ? SLOT_COUNT : HOTBAR_COUNT;
    let remaining = source.count;
    for (let i = start; i < end && remaining; i++) {
      const dest = this.slots[i];
      if (dest && dest.id === source.id && dest.count < stackLimit(dest.id)) {
        const n = Math.min(stackLimit(dest.id) - dest.count, remaining);
        dest.count += n; remaining -= n;
      }
    }
    for (let i = start; i < end && remaining; i++) {
      if (!this.slots[i]) {
        const n = Math.min(remaining, stackLimit(source.id));
        this.slots[i] = { id: source.id, count: n }; remaining -= n;
      }
    }
    if (remaining === source.count) return false;
    if (remaining) source.count = remaining; else this.slots[index] = null;
    this.notify(); return true;
  }
  /** Замена одиночного ведра без промежуточного удаления предмета. */
  convertBucket(index,filled) {
    const item=this.get(index);
    if(item?.count!==1 || !['bucket','water_bucket'].includes(item.id)) return false;
    this.slots[index]={id:filled?'water_bucket':'bucket',count:1};this.notify();return true;
  }
  returnHeld() {
    if (!this.held) return true;
    const moved = this.add(this.held.id, this.held.count);
    this.held.count -= moved;
    if (this.held.count === 0) this.held = null;
    this.notify();return this.held === null;
  }
}
