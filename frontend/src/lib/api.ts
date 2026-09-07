import { apiUrl } from "./config";
import type { Invoice, Load } from "../types";

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export const fetchLoads = () => request<Load[]>("/loads");

export const fetchInvoices = () => request<Invoice[]>("/invoices");

export const createLoad = (input: {
  origin: string;
  destination: string;
  weight: number;
  pickupDate: string;
}) => request<Load>("/loads", { method: "POST", body: JSON.stringify(input) });
