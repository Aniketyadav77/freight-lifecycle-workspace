const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const kg = new Intl.NumberFormat("en-IN");

const day = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });

const dayTime = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

const inrCompact = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  notation: "compact",
  maximumFractionDigits: 1,
});

export const formatRate = (value: number) => inr.format(value);
/** For axis ticks, where the full figure would collide with its neighbours. */
export const formatRateCompact = (value: number) => inrCompact.format(value);
/** City name without the state suffix — lane labels get long fast. */
export const cityOf = (place: string) => place.split(",")[0]!.trim();
export const formatWeight = (value: number) => `${kg.format(value)} kg`;
export const formatDate = (iso: string) => day.format(new Date(iso));
export const formatDateTime = (iso: string) => dayTime.format(new Date(iso));

/** "in 2 days" / "today" / "3 days ago" — pickup urgency at a glance. */
export function formatPickupWindow(iso: string) {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round(
    (startOfDay(new Date(iso)) - startOfDay(new Date())) / 86_400_000,
  );

  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
}
