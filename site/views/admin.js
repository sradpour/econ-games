import { html, store, setState, setUi, on, toast, confirmed, plural } from '../lib/dom.js';
import { rpc } from '../lib/api.js';

export async function enterAdmin() {
  if (!store.me?.is_admin) return;
  const [admin, users, classes] = await Promise.all([
    rpc('admin_overview'), rpc('admin_list_users', { p_search: store.ui.adminSearch || null }), rpc('admin_list_classes'),
  ]);
  setState({ admin, adminUsers: users, adminClasses: classes });
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
    ${usersSection()}
    ${classesSection()}
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

const roleOf = (u) => (u.is_admin ? 'Admin' : u.instructor_status === 'approved' ? 'Instructor' : u.instructor_status === 'pending' ? 'Instructor (pending)' : 'Student');
const when = (t) => (t ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'never');

function usersSection() {
  const users = store.adminUsers || [];
  return html`<section class="card"><h2>All users</h2>
    <form class="inline" data-action="admin-search">
      <input name="q" placeholder="Search name, email or student ID" value="${store.ui.adminSearch || ''}" aria-label="Search users">
      <button type="submit">Search</button>${store.ui.adminSearch ? html`<button type="button" class="link" data-action="admin-search-clear">Show all</button>` : ''}
    </form>
    <p class="small muted">${plural(users.length, 'user')}${users.length >= 300 ? ' (first 300; search to narrow down)' : ''}. Deleting an account removes the person and their game history; classes they teach are deleted too.</p>
    <div class="scroll"><table class="mini"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Student ID</th><th>Classes</th><th>Last sign-in</th><th></th></tr></thead><tbody>
      ${users.map((u) => html`<tr data-key="${u.id}"><td>${u.name || '–'}</td><td>${u.email}</td><td>${roleOf(u)}</td><td>${u.student_id || '–'}</td><td>${u.classes}</td><td>${when(u.last_sign_in_at)}</td>
        <td>${u.is_admin || u.id === store.me.id ? '' : html`<button class="link danger" data-action="admin-delete-user" data-id="${u.id}" data-name="${u.name || u.email}">Delete</button>`}</td></tr>`)}
    </tbody></table></div></section>`;
}

function classesSection() {
  const classes = store.adminClasses || [];
  return html`<section class="card"><h2>All classes</h2>
    ${classes.length === 0 ? html`<p class="muted">No classes yet.</p>` : html`<div class="scroll"><table class="mini"><thead><tr><th>Class</th><th>Instructor</th><th>Code</th><th>Students</th><th>Games</th><th>Created</th><th></th></tr></thead><tbody>
      ${classes.map((c) => html`<tr data-key="${c.id}"><td>${c.name}${c.archived ? html` <span class="chip">archived</span>` : ''}</td><td>${c.instructor}</td><td>${c.join_code}</td><td>${c.students}</td><td>${c.games}</td><td>${when(c.created_at)}</td>
        <td><button class="link danger" data-action="admin-delete-class" data-id="${c.id}" data-name="${c.name}">Delete</button></td></tr>`)}
    </tbody></table></div>`}
    <p class="small muted">Deleting a class removes its games, results and student enrollments. Student accounts stay.</p></section>`;
}

on('admin-search', async (_f, d) => { store.ui.adminSearch = (d.q || '').trim(); await enterAdmin(); });
on('admin-search-clear', async () => { store.ui.adminSearch = ''; await enterAdmin(); });
on('admin-delete-user', async (el) => {
  if (!confirmed(el, `Delete ${el.dataset.name}'s account and game history? This cannot be undone.`)) return;
  await rpc('admin_delete_user', { p_user: el.dataset.id });
  toast(`Deleted ${el.dataset.name}`); await enterAdmin();
});
on('admin-delete-class', async (el) => {
  if (!confirmed(el, `Delete the class "${el.dataset.name}" with all its games and results? This cannot be undone.`)) return;
  await rpc('admin_delete_class', { p_class: el.dataset.id });
  toast(`Deleted ${el.dataset.name}`); await enterAdmin();
});

on('set-instructor', async (el) => {
  await rpc('admin_set_instructor', { p_user: el.dataset.id, p_status: el.dataset.status });
  toast('Updated'); await enterAdmin();
});
on('admin-config', async (form, d) => {
  if (form.dataset.key === 'gemini_api_key' && !d.value) throw new Error('Paste the key first.');
  await rpc('admin_set_config', { p_key: form.dataset.key, p_value: d.value });
  form.reset(); toast('Saved'); await enterAdmin();
});
