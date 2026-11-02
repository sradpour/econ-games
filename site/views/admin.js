import { html, store, setState, on, toast } from '../lib/dom.js';
import { rpc } from '../lib/api.js';

export async function enterAdmin() {
  if (!store.me?.is_admin) return;
  setState({ admin: await rpc('admin_overview') });
}

export function renderAdmin() {
  if (!store.me.is_admin) return html`<main class="page narrow"><h1>Admin</h1><p>Admins only.</p></main>`;
  const a = store.admin;
  if (!a) return html`<main class="page"><p class="muted">Loading…</p></main>`;
  const pending = a.instructors.filter((i) => i.status === 'pending');
  const others = a.instructors.filter((i) => i.status !== 'pending');
  return html`<main class="page teach">
    <h1>Admin</h1>
    <p class="muted">${a.counts.users} users · ${a.counts.classes} classes · ${a.counts.sessions} games</p>
    <section class="card"><h2>Instructor requests</h2>
      ${pending.length === 0 ? html`<p class="muted">No requests waiting.</p>` : html`<ul class="req-list">${pending.map((i) => html`<li data-key="${i.id}">
        <span><strong>${i.name || '–'}</strong> ${i.email}</span>
        <span class="row"><button class="primary" data-action="set-instructor" data-id="${i.id}" data-status="approved">Approve</button>
        <button data-action="set-instructor" data-id="${i.id}" data-status="rejected">Decline</button></span></li>`)}</ul>`}
    </section>
    <section class="card"><h2>Instructors</h2>
      <ul class="req-list">${others.map((i) => html`<li data-key="${i.id}"><span><strong>${i.name || '–'}</strong> ${i.email}${i.is_admin ? ' (admin)' : ''}</span>
        <span>${i.is_admin ? '' : i.status === 'approved' ? html`<button class="link danger" data-action="set-instructor" data-id="${i.id}" data-status="none">Remove access</button>`
          : html`<button class="link" data-action="set-instructor" data-id="${i.id}" data-status="approved">Approve</button>`}</span></li>`)}</ul>
    </section>
    <section class="card"><h2>Settings</h2>
      <form class="stack" data-action="admin-config" data-key="instructor_auto_domains">
        <label>Instructor domains (approved automatically)<input name="value" value="${a.instructor_auto_domains || ''}"><span class="help">Teachers with these email domains get instructor access as soon as they ask. Others wait for you.</span></label>
        <button type="submit">Save</button></form>
      <form class="stack" data-action="admin-config" data-key="default_student_domains">
        <label>Default student domains for new classes<input name="value" value="${a.default_student_domains || ''}"></label>
        <button type="submit">Save</button></form>
      <form class="stack" data-action="admin-config" data-key="gemini_api_key">
        <label>Gemini API key (strategy translator) <input name="value" type="password" autocomplete="off" placeholder="${a.gemini_key_set ? 'A key is saved. Paste a new one to replace it.' : 'Paste your free key from Google AI Studio'}">
        <span class="help">Stored on the server only; students never see it. ${a.gemini_key_set ? 'Status: saved.' : 'Status: not set, so the translator is off.'}</span></label>
        <button type="submit">Save key</button></form>
      <p class="small muted">Engine: ${a.engine_url ? 'connected' : 'not configured'}</p>
    </section>
  </main>`;
}

on('set-instructor', async (el) => {
  await rpc('admin_set_instructor', { p_user: el.dataset.id, p_status: el.dataset.status });
  toast('Updated'); await enterAdmin();
});
on('admin-config', async (form, d) => {
  if (form.dataset.key === 'gemini_api_key' && !d.value) throw new Error('Paste the key first.');
  await rpc('admin_set_config', { p_key: form.dataset.key, p_value: d.value });
  form.reset(); toast('Saved'); await enterAdmin();
});
