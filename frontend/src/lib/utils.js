import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function randomRange(min, max) {
  return Math.random() * (max - min) + min;
}
