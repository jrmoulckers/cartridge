/** Transient status messages. One at a time; the newest wins. */
import { writable } from 'svelte/store';

export type ToastTone = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

export const toast = writable<Toast | null>(null);

let nextId = 1;
let timer: ReturnType<typeof setTimeout> | undefined;

export function showToast(message: string, tone: ToastTone = 'info', ms = 3200): void {
  const id = nextId++;
  toast.set({ id, message, tone });
  clearTimeout(timer);
  timer = setTimeout(() => {
    toast.update((current) => (current?.id === id ? null : current));
  }, ms);
}

export function dismissToast(): void {
  clearTimeout(timer);
  toast.set(null);
}
