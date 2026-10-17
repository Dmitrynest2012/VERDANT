import { BLOCK_ITEMS } from './Terrain.js';

/** Инвентарь: 9 горячих и 27 обычных слотов; все три вида блоков. */
export const SLOT_COUNT = 36;
export const HOTBAR_COUNT = 9;
export const STACK_MAX = 64;
export const BLOCK_ID = 'grass';

function validStack(stack) {
  if (!stack || !Object.hasOwn(BLOCK_ITEMS, stack.id) || !Number.isFinite(stack.count)) return null;
  const count = Math.max(0, Math.min(STACK_MAX, Math.trunc(stack.count)));
  return count ? { id: stack.id, count } : null;
}

export class Inventory {
  constructor(savedSlots = null, onChange = () => {}) {
    this.slots = Array.from({ length: SLOT_COUNT }, (_, i) => validStack(savedSlots?.[i]));
    if (!savedSlots) this.slots[0] = { id: BLOCK_ID, count: 32 };
    this.held = null;
    this.onChange = onChange;
  }

  notify() { this.onChange(this); }

  get(index) { return this.slots[index] ?? null; }

  toJSON() { return this.slots.map((s) => s ? { ...s } : null); }

  /** Добавляет максимально возможное количество блоков, возвращает фактически добавленное. */
  add(id, count) {
    if (!Object.hasOwn(BLOCK_ITEMS, id) || !Number.isFinite(count) || count < 1) return 0;
    let remaining = Math.trunc(count);
    const requested = remaining;
    for (const slot of this.slots) {
      if (slot?.id !== id || slot.count >= STACK_MAX) continue;
      const n = Math.min(remaining, STACK_MAX - slot.count);
      slot.count += n;
      remaining -= n;
      if (!remaining) break;
    }
    if (remaining) {
      for (let i = 0; i < SLOT_COUNT; i++) {
        if (this.slots[i]) continue;
        const n = Math.min(remaining, STACK_MAX);
        this.slots[i] = { id, count: n };
        remaining -= n;
        if (!remaining) break;
      }
    }
    if (requested !== remaining) this.notify();
    return requested - remaining;
  }

  /** Извлекает до count из указанного слота; возвращает извлечённую стопку. */
  take(index, count = 1) {
    const slot = this.get(index);
    if (!slot || count <= 0) return null;
    const n = Math.min(slot.count, Math.trunc(count));
    if (n <= 0) return null;
    const taken = { id: slot.id, count: n };
    slot.count -= n;
    if (slot.count === 0) this.slots[index] = null;
    this.notify();
    return taken;
  }

  /** ЛКМ: подхватить/поставить/объединить/обменять. */
  leftClick(index) {
    if (index < 0 || index >= SLOT_COUNT) return;
    const here = this.slots[index];
    if (!this.held) {
      if (!here) return;
      this.held = here;
      this.slots[index] = null;
    } else if (!here) {
      this.slots[index] = this.held;
      this.held = null;
    } else if (here.id === this.held.id && here.count < STACK_MAX) {
      const n = Math.min(this.held.count, STACK_MAX - here.count);
      here.count += n;
      this.held.count -= n;
      if (this.held.count === 0) this.held = null;
    } else {
      this.slots[index] = this.held;
      this.held = here;
    }
    this.notify();
  }

  /** ПКМ: взять половину либо положить ровно один предмет. */
  rightClick(index) {
    if (index < 0 || index >= SLOT_COUNT) return;
    const here = this.slots[index];
    if (!this.held) {
      if (!here) return;
      const n = Math.ceil(here.count / 2);
      this.held = { id: here.id, count: n };
      here.count -= n;
      if (here.count === 0) this.slots[index] = null;
    } else if (!here) {
      this.slots[index] = { id: this.held.id, count: 1 };
      this.held.count--;
      if (this.held.count === 0) this.held = null;
    } else if (here.id === this.held.id && here.count < STACK_MAX) {
      here.count++;
      this.held.count--;
      if (this.held.count === 0) this.held = null;
    } else {
      return;
    }
    this.notify();
  }

  /** Shift + ЛКМ: горячая панель ↔ рюкзак, сначала дополнение стаков. */
  quickMove(index) {
    if (index < 0 || index >= SLOT_COUNT || this.held) return false;
    const source = this.slots[index];
    if (!source) return false;
    const start = index < HOTBAR_COUNT ? HOTBAR_COUNT : 0;
    const end = index < HOTBAR_COUNT ? SLOT_COUNT : HOTBAR_COUNT;
    let remaining = source.count;
    for (let i = start; i < end && remaining; i++) {
      const dest = this.slots[i];
      if (dest && dest.id === source.id && dest.count < STACK_MAX) {
        const n = Math.min(STACK_MAX - dest.count, remaining);
        dest.count += n;
        remaining -= n;
      }
    }
    for (let i = start; i < end && remaining; i++) {
      if (!this.slots[i]) {
        const n = Math.min(remaining, STACK_MAX);
        this.slots[i] = { id: source.id, count: n };
        remaining -= n;
      }
    }
    if (remaining === source.count) return false;
    if (remaining) source.count = remaining;
    else this.slots[index] = null;
    this.notify();
    return true;
  }

  /** При закрытии инвентаря возвращаем взятую стопку; предметы не теряются. */
  returnHeld() {
    if (!this.held) return true;
    const moved = this.add(this.held.id, this.held.count);
    this.held.count -= moved;
    if (this.held.count === 0) this.held = null;
    this.notify();
    return this.held === null;
  }
}
