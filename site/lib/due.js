// Due dates for assignment / practice games, shown in the viewer's own time zone.

/** "Fri, Nov 20, 11:59 PM" */
export function fmtDue(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** "Due Fri, Nov 20, 11:59 PM", or "Due date passed" once it has. Empty when there is no due date. */
export function dueText(iso, now = Date.now()) {
  if (!iso) return '';
  return new Date(iso).getTime() <= now ? 'Due date passed' : `Due ${fmtDue(iso)}`;
}

const pad = (n) => String(n).padStart(2, '0');
/** ISO time → the value a <input type="datetime-local"> expects, in local time. */
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** A datetime-local value (local time) → ISO, or null when empty or invalid. */
export function fromLocalInput(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** A default due date one week from now at 11:59 PM, for the date picker. */
export function defaultDue() {
  const d = new Date(Date.now() + 7 * 864e5);
  d.setHours(23, 59, 0, 0);
  return toLocalInput(d.toISOString());
}
