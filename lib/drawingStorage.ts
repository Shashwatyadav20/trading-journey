import { ChartDrawing } from "../types/chart";

const DRAWINGS_STORAGE_KEY = "trading-journey-chart-drawings";

export function loadDrawingsFromStorage(): ChartDrawing[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(DRAWINGS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error("Failed to load drawings from localStorage", e);
    return [];
  }
}

export function saveDrawingsToStorage(drawings: ChartDrawing[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DRAWINGS_STORAGE_KEY, JSON.stringify(drawings));
  } catch (e) {
    console.error("Failed to save drawings to localStorage", e);
  }
}

export function clearDrawingsStorage(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(DRAWINGS_STORAGE_KEY);
  } catch (e) {
    console.error("Failed to clear drawings storage", e);
  }
}
