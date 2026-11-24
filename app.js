const $ = (s) => document.querySelector(s);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const state = {
  user: null,
  modules: [],
  connections: [],
  catalog: {},
  conversations: [],
  messages: [],
  conversation: crypto.randomUUID(),
  pending: null,
};
let auth, authSDK, call;
let authEpoch = 0;
const tutorRoot = "/ai-tutor/";
const studentPath = slug => tutorRoot + encodeURIComponent(slug);
const studentHref = m => m.slug ? studentPath(m.slug) : `#/t/${m.id}`;
const incomingStudent = new URLSearchParams(location.search).get("student");
if (location.pathname === tutorRoot && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(incomingStudent || ""))
  history.replaceState(null, "", studentPath(incomingStudent.toLowerCase()) + location.hash);
function notify(message) {
  $("#notice").textContent = message;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => ($("#notice").textContent = ""), 10000);
}
async function api(action, data = {}) {
  if (!call) throw Error("Firebase is not configured yet.");
  const epoch = authEpoch;
  const response = await call({ action, data });
  if (epoch !== authEpoch)
    throw Error("The signed-in account changed. Please try again.");
  return response.data;
}
function login(error = "") {
  $("#app").innerHTML =
    `<main class="login"><section class="login-card"><div class="crest" aria-hidden="true">♧</div><h1>Your module. Your tutor.</h1><p>Sign in to access your course tutor<br>and saved conversations.</p><button id="google-login" ${auth ? "" : "disabled"}><span class="google" aria-hidden="true">G</span>Continue with Google</button>${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}</section></main>`;
  $("#google-login").onclick = () =>
    run(async () =>
      authSDK.signInWithPopup(auth, new authSDK.GoogleAuthProvider()),
    );
}
async function run(fn, button) {
  if (button) button.disabled = true;
  try {
    await fn();
  } catch (e) {
    notify(e.message || "Something went wrong. Please try again.");
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
}
async function refresh() {
  const s = await api("session");
  Object.assign(state, s);
}
const cfg = (m) => m?.published || m?.draft || {};
let conversationWidth = 245;
let expandedWidth = 245;
function bindConversationSidebar() {
  const shell = $(".chat-shell");
  const grip = $("#conversation-divider");
  const restore = $("#restore-history");
  const desktop = matchMedia("(min-width: 701px)");
  const limit = () => Math.min(360, Math.floor(shell.clientWidth / 3));
  function apply(width) {
    conversationWidth = Math.max(0, Math.min(width, limit()));
    shell.style.setProperty("--history-width", conversationWidth + "px");
    shell.classList.toggle("history-closed", conversationWidth === 0);
    grip.setAttribute("aria-valuenow", String(conversationWidth));
    grip.setAttribute("aria-valuemax", String(limit()));
  }
  function collapse() {
    expandedWidth = conversationWidth || expandedWidth;
    apply(0);
    restore.focus();
  }
  restore.onclick = () => {
    apply(expandedWidth);
    grip.focus();
  };
  $("#collapse-history").onclick = collapse;
  grip.onpointerdown = event => {
    if (event.button !== 0 || !event.isPrimary) return;
    if (conversationWidth) expandedWidth = conversationWidth;
    grip.setPointerCapture(event.pointerId);
    shell.classList.add("resizing");
  };
  grip.onpointermove = event => {
    if (!grip.hasPointerCapture(event.pointerId)) return;
    const width = Math.round(event.clientX - shell.getBoundingClientRect().left);
    apply(width < 90 ? 0 : Math.max(160, width));
  };
  grip.onlostpointercapture = () => {
    shell.classList.remove("resizing");
    if (!conversationWidth) restore.focus();
  };
  grip.onkeydown = event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End", "Enter"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home" || event.key === "Enter" || (event.key === "ArrowLeft" && conversationWidth <= 160)) return collapse();
    apply(event.key === "End" ? limit() : Math.max(160, conversationWidth + (event.key === "ArrowLeft" ? -20 : 20)));
  };
  const sync = () => {
    if (!shell.isConnected) return;
    if (desktop.matches) apply(conversationWidth);
  };
  sync();
  window.addEventListener("resize", sync, {signal: sidebarEvents.signal});
}
let sidebarEvents = new AbortController();
function answerSources(answer) {
  if (!answer?.sources?.length) return "";
  return `<aside class="sources" aria-label="Sources for this answer"><h2>Sources for this answer</h2>${answer.sources.map(s =>
    `<button class="source-card" data-source="${esc(s.id)}" data-request="${esc(answer.id)}"><strong>▤ ${esc(s.filename)} · ${esc(s.locator)}</strong>${s.text ? `<blockquote>${esc(s.text.slice(0, 240))}${s.text.length > 240 ? "…" : ""}</blockquote>` : ""}</button>`
  ).join("")}</aside>`;
}
function shell(content, selected = null, student = false) {
  sidebarEvents.abort();
  sidebarEvents = new AbortController();
  const visible = student
    ? state.modules.filter((m) => m.published)
    : state.modules;
  $("#app").innerHTML =
    `<div class="shell${student ? " chat-shell" : ""}"><aside class="sidebar" id="module-navigation">${student ? '<button id="collapse-history" class="history-control" aria-label="Collapse conversations" title="Collapse conversations">‹</button>' : ""}<a href="#/" class="brand">Module Tutor</a>${visible.length ? `<label class="hidden" for="module-switch">Module</label><select id="module-switch"><option value="">Choose a module</option>${visible.map((m) => `<option value="${esc(m.id)}" ${m.id === selected?.id ? "selected" : ""}>${esc(cfg(m).title)}</option>`).join("")}</select>` : ""}${student ? '<button class="gold" id="new-conversation">＋ New conversation</button>' : ""}<nav><a href="#/">Dashboard</a>${state.user.instructor ? ' · <a href="#/create">Create tutor</a>' : ""}</nav>${student ? `<div class="history"><h3>Recent conversations</h3>${state.conversations.map((c) => `<button data-conversation="${esc(c.id)}" class="${c.id === state.conversation ? "active" : ""}">◯ ${esc(c.title)}</button>`).join("") || "<small>No conversations yet.</small>"}</div>` : ""}<div class="account"><div><strong>${esc(state.user.name)}</strong><br>${state.user.instructor ? "Instructor account" : "Student account"}</div><button id="signout">Sign out</button></div></aside>${student ? '<div id="conversation-divider" role="separator" tabindex="0" aria-label="Conversation sidebar width" aria-orientation="vertical" aria-controls="module-navigation" aria-valuemin="0"></div>' : ""}<main class="main">${student ? '<button id="restore-history" class="history-control" aria-controls="module-navigation">Show conversations</button>' : ""}${content}</main></div>`;
  if (student) bindConversationSidebar();
  $("#signout").onclick = () => run(() => authSDK.signOut(auth));
  const select = $("#module-switch");
  if (select)
    select.onchange = () => {
      if (!select.value) return;
      if (student) openStudent(state.modules.find(m => m.id === select.value));
      else location.hash = `/admin/${select.value}`;
    };
}
function bindActions() {
  document
    .querySelectorAll("[data-action]")
    .forEach(
      (b) => (b.onclick = () => run(() => actions[b.dataset.action](b), b)),
    );
}
function dashboard() {
  shell(
    `<header class="topline"><div><p class="muted">YOUR TEACHING & LEARNING SPACE</p><h1>${state.user.instructor ? "Your module tutors" : "Your modules"}</h1><p class="muted">${state.user.instructor ? "Build, test and improve a tutor grounded in your teaching materials." : "A little support for your next step in learning."}</p></div>${state.user.instructor ? '<a class="button primary" href="#/create">＋ Create tutor</a>' : ""}</header><div class="cards">${
      state.modules
        .map((m) => {
          const c = cfg(m);
          return `<article class="card"><span class="pill">${esc(m.paused ? "Paused" : m.published ? "Published" : "Draft")}</span><p class="muted">${esc(c.code)}</p><h2>${esc(c.title)}</h2><p>${esc(c.name)}</p>${m.manage ? `<small>${esc(c.model || "Model not selected")} · ${m.lastActivity ? `Last activity ${new Date(m.lastActivity).toLocaleDateString("en-GB")}` : "No activity yet"}</small><div class="actions"><a class="button" href="#/admin/${m.id}">Configure</a><a class="button" href="#/preview/${m.id}">Preview</a><a class="button" href="#/admin/${m.id}/conversations">Conversations</a><a class="button" href="#/admin/${m.id}/analytics">Analytics</a></div>` : `<a class="button primary" data-student-link href="${esc(studentHref(m))}">Open tutor</a>`}</article>`;
        })
        .join("") ||
      `<div class="empty">${state.user.instructor ? "Create your first module tutor to get started." : "No modules are available yet. Ask your instructor to enroll the Google account you used to sign in."}</div>`
    }</div>${state.user.admin ? `<section class="card" style="margin-top:24px"><h2>Platform administration</h2><p>Role grants are recorded in the audit log.</p><form id="roles" class="form"><label>Google account email<input name="email" type="email" required></label><label>Role<select name="role"><option value="instructor">Instructor</option><option value="student">Student (revoke instructor role)</option><option value="admin">Platform administrator</option></select></label><button class="primary">Save role grant</button></form></section>` : ""}`,
  );
  document.querySelectorAll(".cards .card").forEach((card, index) => {
    const m = state.modules[index];
    if (!m.manage) {
      card.querySelector("[data-student-link]").onclick = event => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        openStudent(m);
      };
      return;
    }
    card.querySelector(".pill").textContent =
      m.status || (m.paused ? "Paused" : m.published ? "Published" : "Draft");
    const meta = document.createElement("p");
    meta.className = "muted";
    meta.textContent = `${m.studentCount || 0} enrolled students`;
    card.insertBefore(meta, card.querySelector(".actions"));
  });
  if (state.user.admin) {
    const b = document.createElement("button");
    b.textContent = "View administrative audit";
    $("#roles").after(b);
    b.onclick = () =>
      run(async () => {
        const rows = await api("audit");
        $("#source-content").innerHTML = rows
          .map(
            (r) =>
              `<p>${esc(new Date(r.at).toLocaleString("en-GB"))} · ${esc(r.action)} · ${esc(r.actor)} · ${esc(r.target)}</p>`,
          )
          .join("");
        $("#source").showModal();
      });
  }
  if ($("#roles"))
    $("#roles").onsubmit = (e) => {
      e.preventDefault();
      run(async () => {
        await api(
          "grantInstructor",
          Object.fromEntries(new FormData(e.target)),
        );
        notify("Role grant saved and audited.");
      }, e.submitter);
    };
}
const input = (label, name, value = "", type = "text", required = false) =>
  `<label>${label}<input type="${type}" name="${name}" value="${esc(value)}" ${required ? "required" : ""} ${type === "number" ? 'min="1"' : ""}></label>`;
const area = (label, name, value = "") =>
  `<label>${label}<textarea name="${name}">${esc(value)}</textarea></label>`;
function details(c = {}) {
  return `<div class="grid2">${input("Module code", "code", c.code, "text", true)}${input("Module title", "title", c.title, "text", true)}</div>${input("Tutor name", "name", c.name, "text", true)}${area("Description", "description", c.description)}${area("Welcome message", "welcome", c.welcome || "Welcome. What would you like to learn?")}${area("Learning outcomes", "outcomes", c.outcomes)}`;
}
function create() {
  if (!state.user.instructor) throw Error("Instructor invitation required.");
  shell(
    `<h1>Create a module tutor</h1><p class="muted">Start with your module. Your progress is saved as a draft. GPT-6.2 Sol is the recommended default when available on your OpenAI connection; Astra remains available for advanced reasoning.</p><div class="stepper"><span class="active">1 Module details</span><span>2 Materials</span><span>3 Provider</span><span>4 Behavior</span><span>5 Publish</span></div><form id="create" class="form card">${details()}<button class="primary">Save draft & add materials →</button></form>`,
  );
  $("#create").onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      const result = await api(
        "create",
        Object.fromEntries(new FormData(e.target)),
      );
      await refresh();
      location.hash = `/admin/${result.id}/materials`;
    }, e.submitter);
  };
}
const tabs = [
  ["overview", "Overview"],
  ["materials", "Materials"],
  ["behavior", "Tutor behavior"],
  ["provider", "Provider & model"],
  ["access", "Student access"],
  ["conversations", "Conversations"],
  ["analytics", "Analytics"],
  ["privacy", "Privacy & retention"],
  ["publish", "Preview & publication"],
];
async function admin(m, tab = "overview") {
  if (!m.manage) throw Error("You cannot manage this module.");
  const c = m.draft;
  let content = "";
  if (tab === "overview")
    content = `<form id="draft" class="card form">${details(c)}<button class="primary">Save draft</button></form>`;
  if (tab === "behavior")
    content = `<form id="draft" class="card form">${area("Tutoring rules", "rules", c.rules)}${area("Starter questions (one per line)", "starters", c.starters.join("\n"))}<label class="check"><input type="checkbox" name="hints" ${c.hints ? "checked" : ""}> Offer hints before complete solutions</label><label class="check"><input type="checkbox" name="examples" ${c.examples ? "checked" : ""}> Allow clearly labelled, generated practice examples</label><button class="primary">Save draft</button></form>`;
  if (tab === "materials") {
    const rows = await api("materials", { module: m.id });
    content = `<div class="warning">Supported: PDF, DOCX, PPTX, TXT and Markdown. Maximum 8 MB per file, 30 files / 100 MB / 600 indexed chunks per module. Scanned text, diagrams and equations are not interpreted reliably. Inspect extracted sources in preview.</div><form id="upload" class="card form"><h2>Add teaching material</h2><p>Configure a provider connection before processing files.</p><label>File<input name="file" type="file" accept=".pdf,.docx,.pptx,.txt,.md" required></label><label>Audience<select name="audience"><option value="instructors">Private, instructor only (default)</option><option value="students">Student retrieval</option></select></label><label class="check"><input type="checkbox" name="authorized" required> I am authorized to use this material for this module and to send its extracted text to the configured AI provider.</label><button class="primary">Upload & process</button><p id="upload-progress" role="status"></p></form><div class="scroll"><table><thead><tr><th>Material</th><th>Audience</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.filename)}<br><small>${esc(r.warning || r.error)}<br>Version ${esc(r.version.slice(0, 10))}</small></td><td>${esc(r.audience)}</td><td>${esc(r.state)}${r.state === "removed" ? ` · cleanup ${esc(r.cleanup)}` : ""}</td><td>${r.state !== "removed" ? `<button data-action="removeMaterial" data-material="${r.id}">Remove</button>` : ""}${["failed", "processing", "uploaded"].includes(r.state) ? `<button data-action="retryMaterial" data-material="${r.id}">Retry</button>` : ""}</td></tr>`).join("") || '<tr><td colspan="4">No materials uploaded.</td></tr>'}</tbody></table></div><p class="muted">Removing a file excludes it from new answers immediately. Previously generated text can still contain information from that file. Old assistant answers are never reused as model context.</p>`;
  }
  if (tab === "provider") {
    const choices = state.connections.filter((x) => !x.revoked);
    const selected = choices.find((x) => x.id === c.connection);
    const live = state.connections.find(x => x.id === m.published?.connection);
    const liveStatus = m.published ? `<h2>Live tutor</h2><p>Current selection: <strong>${esc(live?.name || "Saved connection")} · ${esc(m.published.model)}</strong></p><p>Switch the connection and model for new questions at any time. Students keep their link and conversation history. This selection stays active until you change it.</p>` : "";
    content = `${liveStatus}<div class="warning">Your selected providers bill their respective accounts. If a provider reports exhausted funds or quota, the tutor tries the next backup in order. Students never enter a key or select a model. Application quotas limit request counts; they are not a monetary billing cap.</div><form id="draft" class="form card"><label>Provider connection<select id="connection" name="connection" required><option value="">Choose a connection</option>${choices.map((x) => `<option value="${x.id}" ${x.id === c.connection ? "selected" : ""}>${esc(x.name)} · ${esc(x.provider || "openai")} · ${esc(x.masked)}</option>`).join("")}</select></label><label>Supported model<select name="model" id="model" required>${tutorModelOptions(selected, c.model)}</select></label><h3>Backup connections</h3><div id="backups"></div><button type="button" id="add-backup">Add backup</button><div class="actions"><button>Save draft selection</button>${m.published ? '<button id="switch-live-provider" class="primary">Apply to live tutor</button>' : ""}</div></form><form id="connect" class="card form" style="margin-top:20px"><h2>Add a provider connection</h2><label>API provider<select name="provider" id="api-provider">${Object.entries(state.catalog).filter(([, v]) => v.available).map(([id, v]) => `<option value="${esc(id)}">${esc(v.label || id)}</option>`).join("")}</select></label>${input("Connection name", "name", "", "text", true)}${input("API key", "key", "", "password", true)}<label>Save as<select name="replace"><option value="">New connection</option>${choices.map((x) => `<option value="${x.id}">Replace ${esc(x.name)}</option>`).join("")}</select></label><small>Validated on the server and saved in Google Cloud Secret Manager. A saved key can never be shown again.</small><div class="actions"><button class="primary">Validate & save connection</button></div></form><h3>Your connections</h3>${state.connections.map((x) => `<p>${esc(x.name)} · ${esc(x.masked)} · ${x.revoked ? "Revoked" : `<button data-action="refreshConnection" data-connection="${x.id}">Refresh available models</button> <button data-action="revoke" data-connection="${x.id}">Revoke</button>`}</p>`).join("")}<p class="muted">For an openly licensed model, look for Mistral Small 4 on your Mistral AI connection.</p>${modelGuidance()}`;
  }
  if (tab === "access") {
    const roster = await api("roster", { module: m.id });
    content = `<div class="card form"><h2>Enroll Google accounts</h2><p>A tutor link alone does not grant access. Personal and Workspace Google accounts, including UCD accounts, are supported.</p><form id="enroll">${input("Student Google email", "email", "", "email", true)}<button class="primary">Enroll student</button></form></div><h3>${roster.filter((x) => x.active).length} enrolled students</h3><div class="scroll"><table><tbody>${roster.map((x) => `<tr><td>${esc(x.email)}</td><td>${x.active ? "Enrolled" : "Removed"}</td><td>${x.active ? `<button data-action="unenroll" data-email="${esc(x.email)}">Remove access</button>` : ""}</td></tr>`).join("")}</tbody></table></div><form id="collaborate" class="card form" style="margin-top:20px"><h3>Collaborator access</h3><p>Only the owner can grant a collaborator. Use their Firebase user ID after they sign in.</p>${input("Collaborator user ID", "uid", "", "text", true)}<button>Add collaborator</button></form>`;
  }
  if (tab === "publish")
    content = `<section class="card form"><h2>Test, then publish</h2><p>Draft changes do not alter the published tutor. All student materials must be ready, with an active provider connection and supported model.</p><p>Current publication: ${m.published ? `version ${m.version}` : "Not published"}</p><div class="actions"><a class="button" href="#/preview/${m.id}">Test draft</a><button class="primary" data-action="publish">Publish new version</button><button data-action="pause">${m.paused ? "Resume tutor" : "Pause tutor"}</button></div></section>
      <form id="student-link" class="card form"><h2>Student link</h2>
      <label>Link ending<input name="ending" value="${esc(m.slug)}" maxlength="64" required aria-describedby="link-help"></label>
      <small id="link-help">Choose a unique ending using letters, numbers, hyphens or underscores. Previous links keep working. Students need enrollment and a published tutor.</small>
      <button class="primary">Save link ending</button>
      <label>Student URL<input readonly value="${esc(new URL(studentPath(m.slug), location.origin).href)}"></label></form>`;
  if (tab === "privacy") {
    const reqs = await api("deletionRequests", { module: m.id });
    content = `<form id="draft" class="card form"><h2>Retention & quotas</h2>${input("Conversation retention (7–365 days)", "retentionDays", c.retentionDays, "number")}${input("Module questions per day (1–5000)", "dailyQuota", c.dailyQuota, "number")}${input("Questions per student per day (1–100)", "studentDailyQuota", c.studentDailyQuota, "number")}<p>Daily maintenance permanently deletes conversations past their last-activity retention window. Publish changes to apply them to students. Audit metadata is kept for 365 days. No institutional approval or legal compliance is claimed.</p><button class="primary">Save draft</button></form><h3>Student erasure requests</h3>${reqs.map((r) => `<p>${esc(r.email)} · ${esc(r.state)} ${r.state === "requested" ? `<button data-action="approveDeletion" data-request="${r.id}">Approve permanent erasure</button>` : ""}</p>`).join("") || "<p>No requests.</p>"}<p><a href="#/privacy/${m.id}">Read student privacy details</a></p>`;
  }
  if (tab === "conversations") {
    const cs = await api("conversations", { module: m.id, review: true });
    content = `<div class="topline"><div><h2>Student questions & conversations</h2><p>Review questions to identify gaps and improve this tutor. Published instructions change only when you approve and publish a new draft.</p></div><button data-action="export">Export CSV</button></div><label>Filter conversations<input id="filter" placeholder="Search question or student ID"></label><div id="review-list">${cs.map((c) => `<article class="card review-row" style="margin:12px 0"><strong>${esc(c.title)}</strong><p><small>${esc(c.student)} · ${new Date(c.updatedAt).toLocaleString("en-GB")}${c.preview ? " · instructor preview" : ""}</small></p><button data-action="review" data-conversation="${c.id}">Inspect questions & evidence</button><div id="review-${c.id}"></div></article>`).join("") || '<div class="empty">Questions will appear after students use this module.</div>'}</div>`;
  }
  if (tab === "analytics") {
    const a = await api("analytics", { module: m.id });
    content = `<h2>Module usage</h2><div class="metrics">${[
      ["Active students", a.students],
      ["Conversations", a.conversations],
      ["Questions", a.questions],
      ["Questions the materials couldn’t answer", a.insufficient],
      ["Errors / interruptions", a.errors],
      ["Mean latency (ms)", a.meanLatencyMs],
      ["Input tokens", a.inputTokens],
      ["Output tokens", a.outputTokens],
    ]
      .map(([k, v]) => `<div class="metric"><strong>${v}</strong>${k}</div>`)
      .join(
        "",
      )}</div><p class="muted">${esc(a.costNote)} Token totals include only usage returned by successful generation calls. Embedding usage is recorded per request separately.</p><h3>Questions over time</h3><table><tbody>${
      Object.entries(a.days)
        .map(([day, count]) => `<tr><td>${day}</td><td>${count}</td></tr>`)
        .join("") || "<tr><td>No activity yet.</td></tr>"
    }</tbody></table><h3>Feedback & reported issues</h3>${a.feedback.map((f) => `<article class="card"><strong>${esc(f.rating)}</strong><p>${esc(f.question)}</p><p>${esc(f.issue)}</p></article>`).join("") || "<p>No feedback yet.</p>"}`;
    if (a.todayQuestions >= a.dailyQuota * 0.8)
      content =
        `<div class="warning">Usage warning: ${a.todayQuestions} of ${a.dailyQuota} daily questions used. The server will enforce the daily request quota.</div>` +
        content;
    content +=
      '<section class="card"><h3>Improve your tutor</h3><p>Explicitly send up to 80 module questions without student identifiers to your provider for draft improvement suggestions. This does not train a model or change published instructions.</p><button data-action="suggestImprovements">Suggest tutor improvements</button><div id="improvement-suggestions"></div></section>';
  }
  shell(
    `<header class="topline"><div><p class="muted">${esc(c.code)} · INSTRUCTOR ADMINISTRATION</p><h1>${esc(c.title)}</h1><p>${esc(c.name)} · <span class="pill">${m.paused ? "Paused" : m.published ? "Published" : "Draft"}</span></p></div><a class="button" href="#/preview/${m.id}">Preview tutor</a></header><nav class="tabs">${tabs.map(([key, label]) => `<a href="#/admin/${m.id}/${key}" class="${key === tab ? "active" : ""}">${label}</a>`).join("")}</nav>${content}`,
    m,
  );
  bindActions();
  if ($("#student-link")) $("#student-link").onsubmit = e => {
    e.preventDefault();
    const ending = new FormData(e.target).get("ending");
    run(async () => {
      const result = await api("setStudentLink", { module: m.id, ending });
      m.slug = result.slug;
      await render();
      notify("Student link saved.");
    }, e.submitter);
  };
  if ($("#draft"))
    $("#draft").onsubmit = (e) => {
      e.preventDefault();
      run(async () => {
        const fd = new FormData(e.target);
        const update = Object.fromEntries(fd);
        if (tab === "provider") update.backups = [...document.querySelectorAll("#backups fieldset")].map(row => ({ connection: row.querySelector("select").value, model: row.querySelector(".backup-model").value }));
        if (tab === "behavior") {
          update.starters = String(update.starters).split("\n").filter(Boolean);
          update.hints = fd.has("hints");
          update.examples = fd.has("examples");
        }
        const switchLive = e.submitter?.id === "switch-live-provider";
        if (switchLive) {
          await api("switchProvider", { module: m.id, version: m.version, connection: update.connection, model: update.model, backups: update.backups });
        } else {
          await api("saveDraft", { module: m.id, config: { ...m.draft, ...update } });
        }
        await refresh();
        notify(
          switchLive ? "Live provider updated for new questions." : "Draft saved. Publish it when you are ready for students to use these changes.",
        );
        await render();
      }, e.submitter);
    };
  if ($("#backups")) {
    const choices = state.connections.filter(x => !x.revoked);
    function addBackup(entry = {}) {
      const row = document.createElement("fieldset");
      row.innerHTML = `<label>Backup connection<select required><option value="">Choose a connection</option>${choices.map(x => `<option value="${esc(x.id)}">${esc(x.name)} · ${esc(x.provider)} · ${esc(x.masked)}</option>`).join("")}</select></label><label>Backup model<select required class="backup-model"></select></label><button type="button">Remove backup</button>`;
      const select = row.querySelector("select");
      select.value = entry.connection || "";
      select.onchange = () => {
        row.querySelector(".backup-model").innerHTML = (choices.find(x => x.id === select.value)?.models || []).map(model => `<option>${esc(model)}</option>`).join("");
      };
      select.onchange();
      if (entry.model) row.querySelector(".backup-model").value = entry.model;
      row.querySelector("button").onclick = () => row.remove();
      $("#backups").append(row);
    }
    (c.backups || []).forEach(addBackup);
    $("#add-backup").onclick = () => addBackup();
    const provider = $("#api-provider");
    provider.onchange = () => {
      $("#connect").elements.replace.innerHTML = '<option value="">New connection</option>' + choices.filter(x => (x.provider || "openai") === provider.value).map(x => `<option value="${esc(x.id)}">Replace ${esc(x.name)}</option>`).join("");
    };
    provider.onchange();
  }
  if ($("#connection"))
    $("#connection").onchange = (e) => {
      $("#model").innerHTML = tutorModelOptions(state.connections.find(x => x.id === e.target.value));
    };
  for (const action of ["connect", "enroll", "collaborate"])
    if ($(`#${action}`))
      $(`#${action}`).onsubmit = (e) => {
        e.preventDefault();
        run(async () => {
          const data = Object.fromEntries(new FormData(e.target));
          if (action === "connect") e.target.elements.key.value = "";
          await api(action, { ...data, module: m.id });
          await refresh();
          notify(
            action === "connect"
              ? "Connection validated and saved."
              : "Access updated.",
          );
          await render();
        }, e.submitter);
      };
  if ($("#upload"))
    $("#upload").onsubmit = (e) => {
      e.preventDefault();
      run(async () => {
        const file = e.target.elements.file.files[0];
        if (file.size > 8 * 1024 * 1024)
          throw Error("Maximum file size is 8 MB.");
        $("#upload-progress").textContent =
          "Uploading, extracting and indexing. This can take up to two minutes…";
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        await api("upload", {
          module: m.id,
          filename: file.name,
          base64,
          audience: e.target.elements.audience.value,
          authorized: e.target.elements.authorized.checked,
        });
        notify("Material ready. Review the excerpts in preview.");
        await render();
      }, e.submitter);
    };
  if ($("#filter"))
    $("#filter").oninput = (e) => {
      document
        .querySelectorAll(".review-row")
        .forEach(
          (row) =>
            (row.hidden = !row.textContent
              .toLowerCase()
              .includes(e.target.value.toLowerCase())),
        );
    };
}
function tutorModelOptions(connection, current = "") {
  const models = connection?.models || [];
  const recommended = state.catalog.openai?.recommendedModel || "gpt-6.2-sol";
  const choice = models.includes(current) ? current : models.includes(recommended) ? recommended : models[0];
  return [...models].sort((a, b) => Number(b === recommended) - Number(a === recommended)).map(model =>
    `<option value="${esc(model)}" ${model === choice ? "selected" : ""}>${esc(model)}${model === recommended ? " — Recommended default" : model === "gpt-6.2-astra" ? " — Advanced reasoning" : ""}</option>`).join("");
}
function modelGuidance() {
  return `<section class="card"><h2>Choose a tutor model</h2><p><strong>Guidance and standard API prices checked 24 November 2026.</strong> Prices below are USD per one million tokens, with uncached input and standard processing. Check the linked current rates before budgeting.</p><div class="scroll"><table><thead><tr><th>Model</th><th>Suggested use</th><th>Input</th><th>Output</th></tr></thead><tbody><tr><td>GPT-6.2 Sol</td><td>Recommended default for new tutors: everyday course tutoring, hints and multilingual conversations, including Chinese. Validate with representative course questions.</td><td>$2</td><td>$10</td></tr><tr><td>GPT-6.2 Astra</td><td>OpenAI’s most capable model; consider for difficult reasoning, nuanced explanations and demanding courses. Multilingual support alone does not require it.</td><td>$8</td><td>$40</td></tr></tbody></table></div><p>Both models support multilingual text. Voice dictation uses the separate GPT-Transcribe model to recognize the original language; the tutor then replies in that language and adds English translations. No Chinese-specific tutor model is needed.</p><p>Illustration: 3,000 input tokens and 1,000 billed output tokens cost about $0.016 with Sol or $0.064 with Astra per question (about $16 / $64 for 1,000 such questions). This is arithmetic, not a measured average or spending cap. Retrieved documents add input; reasoning tokens and English translations add billed output. Non-English text can use different token counts. Transcription, document embeddings, Firebase, taxes and any regional surcharges are additional. GPT-Transcribe is $0.0045 per audio minute ($0.27 per hour), checked on the same date; this is additional to tutor text costs.</p><p>Our recommendation: start with Sol, test Chinese and your course’s hardest questions, and compare answers before choosing Astra. Existing published selections change only when you save and publish. Older GPT-4.1 options remain for existing modules; this guidance focuses on the current models. Availability depends on your OpenAI project.</p><p><a href="https://developers.openai.com/api/docs/models" target="_blank" rel="noopener">OpenAI model capabilities</a> · <a href="https://developers.openai.com/api/docs/pricing" target="_blank" rel="noopener">Current OpenAI pricing</a> · <a href="https://developers.openai.com/api/docs/models/gpt-transcribe" target="_blank" rel="noopener">Transcription pricing</a> · <a href="https://developers.openai.com/api/docs/guides/speech-to-text" target="_blank" rel="noopener">Multilingual transcription</a></p></section>`;
}
function currentModule() {
  return state.modules.find((m) => m.id === location.hash.split("/")[2]);
}
const actions = {
  async refreshConnection(b) {
    await api("refreshConnection", { connection: b.dataset.connection });
    await refresh(); await render(); notify("Available models refreshed using the saved connection.");
  },
  async suggestImprovements() {
    const r = await api("suggestImprovements", { module: currentModule().id });
    $("#improvement-suggestions").innerHTML =
      `<div class="record">${esc(r.summary)}</div><p>${esc(r.notice)}</p>`;
  },
  async removeMaterial(b) {
    notify(
      (
        await api("removeMaterial", {
          module: currentModule().id,
          material: b.dataset.material,
        })
      ).notice,
    );
    await render();
  },
  async retryMaterial(b) {
    await api("retryMaterial", {
      module: currentModule().id,
      material: b.dataset.material,
    });
    await render();
  },
  async revoke(b) {
    await api("revoke", { connection: b.dataset.connection });
    await refresh();
    await render();
  },
  async unenroll(b) {
    await api("enroll", {
      module: currentModule().id,
      email: b.dataset.email,
      active: false,
    });
    await render();
  },
  async publish() {
    await api("publish", { module: currentModule().id });
    await refresh();
    notify("New tutor version published.");
    await render();
  },
  async pause() {
    const m = currentModule();
    await api("pause", { module: m.id, paused: !m.paused });
    await refresh();
    await render();
  },
  async approveDeletion(b) {
    await api("approveDeletion", {
      module: currentModule().id,
      request: b.dataset.request,
    });
    notify("Student conversation records permanently deleted.");
    await render();
  },
  async export() {
    await downloadExport(currentModule().id, true);
  },
  async review(b) {
    const module = currentModule().id,
      conversation = b.dataset.conversation;
    const rs = await api("messages", { module, conversation, review: true });
    $(`#review-${conversation}`).innerHTML = rs
      .map(
        (r) =>
          `<div class="record"><small>${new Date(r.at).toLocaleString("en-GB")} · ${esc(r.status)} · ${esc(r.model)} · configuration ${esc(r.configVersion)} · index ${esc(r.materialVersion)}</small>${r.studentRemoved ? "<p class=muted>Removed or superseded in the student’s chat; retained for instructor review.</p>" : ""}<h3>Student question</h3><p>${esc(r.question)}</p>${englishMarkup(r)}<h3>Tutor response</h3><p>${esc(r.answer || r.error?.message || "Pending")}</p>${(r.sources || []).map((s) => `<button class="source-chip" data-review-source="${esc(s.id)}" data-request="${r.id}" data-conversation="${conversation}">${esc(s.filename)} · ${esc(s.locator)}</button>`).join("")}<p><small>${esc(r.feedback?.rating || "No feedback")} ${esc(r.feedback?.issue || "")}</small></p></div>`,
      )
      .join("");
    document
      .querySelectorAll("[data-review-source]")
      .forEach(
        (x) =>
          (x.onclick = () =>
            run(() =>
              showSource(
                module,
                x.dataset.conversation,
                x.dataset.request,
                x.dataset.reviewSource,
                true,
              ),
            )),
      );
  },
};
async function downloadExport(module, review = false) {
  const r = await api("export", { module, review });
  const url = URL.createObjectURL(
    new Blob(["\uFEFF" + r.csv], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `module-${module}-questions.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function showSource(
  module,
  conversation,
  request,
  source,
  review = false,
) {
  const s = await api("source", {
    module,
    conversation,
    request,
    source,
    review,
  });
  $("#source-content").innerHTML =
    `<h3>${esc(s.filename)}</h3><p class="muted">${esc(s.locator)} · material version ${esc(s.version.slice(0, 12))}</p><pre>${esc(s.text)}</pre>`;
  $("#source").showModal();
}
$("#close-source").onclick = () => $("#source").close();
function composer(paused) {
  const disabled = paused ? "disabled" : "";
  const send = state.editing ? "Save & regenerate" : "Send question";
  return `<form id="ask" class="composer">
    <textarea id="question" rows="2" maxlength="4000" required aria-label="Ask about your module" placeholder="Ask about your module…" ${disabled}></textarea>
    <div class="composer-tools">
      <button id="add-file" type="button" aria-expanded="false" aria-controls="file-options" aria-label="Add attachment" title="Add attachment" ${disabled}>+</button>
      <div id="file-options" hidden>
        <button type="button" data-picker="student-file">Attach a document <small>Up to 4 MB</small></button>
        <button type="button" data-picker="voice-file">Transcribe a recording <small>Up to 2 MB</small></button>
      </div>
      <input id="student-file" hidden type="file" accept=".pdf,.docx,.pptx,.txt,.md">
      <input id="voice-file" hidden type="file" accept="audio/webm,audio/mp4,audio/ogg,audio/wav,audio/mpeg">
      <button id="remove-file" type="button" hidden title="Remove attachment"></button>
      <button id="dictate" type="button" aria-label="Speak your question" title="Speak your question" aria-pressed="false" ${disabled}>
        <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3"/></svg>
      </button>
      <button type="submit" class="primary" aria-label="${send}" title="${send}" ${disabled}>↑</button>
    </div>
  </form><p id="voice-status" role="status"></p>`;
}

function bindAttachments() {
  const add = $("#add-file"), options = $("#file-options");
  function toggleOptions(open) {
    options.hidden = !open;
    add.setAttribute("aria-expanded", String(open));
  }
  add.onclick = () => toggleOptions(options.hidden);
  $("#ask").onfocusout = e => {
    if (!options.contains(e.relatedTarget) && e.relatedTarget !== add) toggleOptions(false);
  };
  $("#ask").onkeydown = e => {
    if (e.key === "Escape" && !options.hidden) { toggleOptions(false); add.focus(); }
  };
  options.onclick = e => {
    const item = e.target.closest("[data-picker]");
    if (!item) return;
    toggleOptions(false);
    add.focus();
    document.getElementById(item.dataset.picker).click();
  };
  const fileInput = $("#student-file"), remove = $("#remove-file");
  fileInput.onchange = () => {
    const file = fileInput.files[0];
    remove.hidden = !file;
    remove.textContent = file ? file.name + " ×" : "";
    remove.setAttribute("aria-label", file ? "Remove " + file.name : "Remove attachment");
  };
  remove.onclick = () => { fileInput.value = ""; fileInput.onchange(); add.focus(); };
}

async function chat(m, preview = false) {
  const config = preview ? m.draft : m.published;
  if (!config) throw Error("This tutor is not published.");
  if (state.chatModule !== m.id || state.preview !== preview) {
    state.conversation = crypto.randomUUID();
    state.messages = [];
    state.chatModule = m.id;
    state.preview = preview;
    state.pending = null;
    state.editing = null;
  }
  state.conversations = await api("conversations", { module: m.id });
  const currentConversation = state.conversations.find(c => c.id === state.conversation);
  shell(
    `<div class="chat-layout"><section class="chat"><header class="topline"><div><h1>${esc(config.title)}</h1><p class="muted">Your course tutor · Instructor: ${esc(m.instructor)}</p></div><span class="pill">▣ Based on module materials</span></header>${preview ? `<div class="warning">Instructor draft preview. Questions and responses are recorded as preview activity. <a href="#/admin/${m.id}/publish">Return to publication</a></div>` : ""}${m.paused ? '<div class="warning">Your instructor has paused this tutor.</div>' : ""}${currentConversation ? `<form id="conversation-title" class="conversation-title"><label>Conversation title<input name="title" maxlength="90" required value="${esc(currentConversation.title)}"></label><button type="submit">Save title</button></form>` : ""}<div class="starters"><button data-starter="Explain a concept">♧ Explain a concept</button><button data-starter="Give me a hint">♧ Give me a hint</button><button data-starter="Quiz me">☷ Quiz me</button></div><div id="messages" class="messages" aria-live="polite">${state.messages.length ? "" : `<div class="empty"><h2>${esc(config.name)}</h2><p>${esc(config.welcome)}</p>${config.starters.map((q) => `<button data-starter="${esc(q)}">${esc(q)}</button>`).join(" ")}</div>`}${state.messages.map((r) => messageMarkup(r)).join("")}</div>${state.editing ? `<div class="warning" role="status">Editing your question. Save & regenerate replaces its answer and removes later exchanges from your chat. Instructor review records remain. Reattach any document needed for the new answer.<div class="actions"><button id="cancel-edit" type="button">Cancel edit</button></div></div>` : ""}${composer(m.paused)}<p class="ai-note">AI can make mistakes. Check the cited sources.</p><div class="actions"><button id="export-own">Export my questions</button><button id="hide" ${currentConversation ? "" : "disabled"}>Delete conversation</button><a href="#/privacy/${m.id}">Privacy details</a></div></section>${answerSources(state.messages.at(-1))}</div>`,
    m,
    true,
  );
  document.querySelectorAll("[data-starter]").forEach(
    (b) =>
      (b.onclick = () => {
        $("#question").value = b.dataset.starter + ": ";
        $("#question").focus();
      }),
  );
  bindAttachments();
  $("#voice-file").onchange = e => run(async () => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) throw Error("Recording exceeds 2 MB.");
    const box = $("#question"), status = $("#voice-status");
    status.textContent = "Transcribing recording…";
    const mime = file.type.split(";")[0].replace("audio/x-wav", "audio/wav");
    try {
      const result = await api("transcribe", { module: m.id, preview, mime, audio: await blobBase64(file) });
      if (!box.isConnected) return;
      box.value = (box.value + " " + result.text).trim(); box.focus();
      status.textContent = "Review or edit your transcript, then send. English translations appear with the reply.";
    } catch (error) { status.textContent = "Transcription failed. Please try again or type your question."; throw error; }
    finally { e.target.value = ""; }
  });
  const box = $("#question"), status = $("#voice-status"), button = $("#dictate");
  let recording = null;
  $("#dictate").onclick = () => run(async () => {
    if (recording) { recording.stop(); return; }
    if (m.paused) throw Error("Your instructor has paused this tutor.");
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw Error("Voice input is unavailable in this browser. Please type your question.");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = ["audio/webm", "audio/mp4", "audio/ogg"].find(t => MediaRecorder.isTypeSupported(t));
    if (!mime) { stream.getTracks().forEach(t => t.stop()); throw Error("Unsupported recording format. Please type your question."); }
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    recording = recorder;
    const parts = []; let bytes = 0;
    recorder.ondataavailable = e => { parts.push(e.data); bytes += e.data.size; if (bytes >= 1900000 && recorder.state === "recording") recorder.stop(); };
    const timer = setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, 60000);
    recorder.onstop = () => {
      clearTimeout(timer); stream.getTracks().forEach(t => t.stop()); recording = null;
      if (!box?.isConnected) return;
      button.setAttribute("aria-pressed", "false"); button.title = button.ariaLabel = "Speak your question"; button.disabled = true; status.textContent = "Transcribing…";
      run(async () => {
        try {
          const audio = await blobBase64(new Blob(parts, { type: mime }));
          const result = await api("transcribe", { module: m.id, preview, mime, audio });
          if (!box.isConnected) return;
          box.value = (box.value + " " + result.text).trim(); box.focus();
          status.textContent = "Review or edit your transcript, then send. English translations appear with the reply.";
        } catch (error) { status.textContent = "Transcription failed. Please try again or type your question."; throw error; } finally { button.disabled = false; }
      });
    };
    recorder.start(1000); button.setAttribute("aria-pressed", "true"); button.title = button.ariaLabel = "Stop recording";
    $("#voice-status").textContent = "Listening… Stop when finished (maximum 60 seconds). Audio will be sent to OpenAI. Your instructor can review the submitted text.";
  });
  $("#new-conversation").onclick = () => {
    state.editing = null;
    state.conversation = crypto.randomUUID();
    state.messages = [];
    state.pending = null;
    run(() => chat(m, preview));
  };
  document.querySelectorAll("[data-conversation]").forEach(
    (b) =>
      (b.onclick = () =>
        run(async () => {
          state.conversation = b.dataset.conversation;
          state.pending = null;
          state.editing = null;
          state.messages = await api("messages", {
            module: m.id,
            conversation: state.conversation,
          });
          await chat(m, preview);
        })),
  );
  $("#ask").onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      const question = $("#question").value.trim();
      if (state.pending && state.pending.question !== question)
        throw Error(
          "Resolve the pending question first. Retry with the same text to avoid duplicate requests.",
        );
      const request = state.pending?.request || crypto.randomUUID();
      let attachments = state.pending?.attachments || [];
      const file = $("#student-file").files[0];
      if (!state.pending && file) {
        if (file.size > 4 * 1024 * 1024) throw Error("Document exceeds 4 MB.");
        attachments = [{ filename: file.name, data: await blobBase64(file) }];
      }
      const replaces = state.pending?.replaces || state.editing || null;
      state.pending = { request, question, attachments, replaces };
      $("#messages").insertAdjacentHTML(
        "beforeend",
        '<p id="thinking" role="status">Finding module evidence and preparing an answer…</p>',
      );
      try {
        const r = await api("ask", {
          module: m.id,
          conversation: state.conversation,
          request,
          question,
          attachments,
          ...(replaces ? { replaces } : {}),
          preview,
        });
        state.messages = await api("messages", { module: m.id, conversation: state.conversation });
        state.editing = null;
        state.pending = null;
        await chat(m, preview);
        if (r.error) notify(r.error.message + (replaces ? " Your original exchange is unchanged." : ""));
      } catch (error) {
        $("#thinking")?.remove();
        throw Error(
          `${error.message} Your question remains in the box. Submitting it again uses the same request ID.`,
        );
      }
    }, e.submitter);
  };
  document
    .querySelectorAll("[data-source]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          run(() =>
            showSource(
              m.id,
              state.conversation,
              b.dataset.request,
              b.dataset.source,
            ),
          )),
    );
  document.querySelectorAll("[data-feedback]").forEach(
    (b) =>
      (b.onclick = () =>
        run(async () => {
          let issue = "";
          if (b.dataset.feedback === "issue") {
            const value = prompt(
              "Describe the issue (do not include sensitive personal data).",
            );
            if (value === null) return;
            issue = value;
          }
          await api("feedback", {
            module: m.id,
            conversation: state.conversation,
            request: b.dataset.request,
            rating: b.dataset.feedback,
            issue,
          });
          notify("Feedback recorded. Thank you.");
        }, b)),
  );
  const titleForm = $("#conversation-title");
  if (titleForm) titleForm.onsubmit = e => {
    e.preventDefault();
    run(async () => {
      await api("renameConversation", { module: m.id, conversation: state.conversation, title: titleForm.elements.title.value.trim() });
      await chat(m, preview);
      notify("Conversation title saved.");
    }, e.submitter);
  };
  document.querySelectorAll("[data-edit-request]").forEach(b => b.onclick = () => run(async () => {
    if (state.pending) throw Error("Retry the pending question before editing another exchange.");
    state.editing = b.dataset.editRequest;
    await chat(m, preview);
    $("#question").focus();
  }));
  document.querySelectorAll("[data-delete-request]").forEach(b => b.onclick = () => run(async () => {
    if (!confirm("Delete this question and its answer from your chat? Instructor review records remain under the module retention policy.")) return;
    const result = await api("deleteExchange", { module: m.id, conversation: state.conversation, request: b.dataset.deleteRequest });
    state.messages = await api("messages", { module: m.id, conversation: state.conversation });
    state.editing = null;
    await chat(m, preview);
    notify(result.notice);
  }, b));
  if ($("#cancel-edit")) $("#cancel-edit").onclick = () => { state.editing = null; run(() => chat(m, preview)); };
  $("#export-own").onclick = () => run(() => downloadExport(m.id));
  $("#hide").onclick = () =>
    run(async () => {
      if (!confirm("Delete this conversation from your chat history? Instructor review records remain until retention expires or an erasure request is approved.")) return;
      notify(
        (
          await api("deleteConversation", {
            module: m.id,
            conversation: state.conversation,
          })
        ).notice,
      );
      state.conversation = crypto.randomUUID();
      state.messages = [];
      state.editing = null;
      await chat(m, preview);
    });
  if (state.pending) $("#question").value = state.pending.question;
  else if (state.editing) $("#question").value = state.messages.find(r => r.id === state.editing)?.question || "";
  $("#messages").scrollTop = $("#messages").scrollHeight;
}
function englishMarkup(r) {
  if (!r.questionEnglish && !r.answerEnglish) return "";
  return '<details class="english"><summary>English translation</summary><p dir="auto">' + esc(r.questionEnglish || "") + '</p><p dir="auto">' + esc(r.answerEnglish || "") + '</p></details>';
}
async function blobBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(Error("Unable to read file or recording."));
    reader.readAsDataURL(blob);
  });
}
function messageMarkup(r) {
  return `<div class="question" dir="auto">${esc(r.question)}<div class="actions question-actions"><button type="button" data-edit-request="${esc(r.id)}">Edit question</button><button type="button" data-delete-request="${esc(r.id)}">Delete exchange</button></div>${(r.attachments || []).map(f => `<small> · ${esc(f.filename)} (student upload)</small>`).join("")}</div>${englishMarkup(r)}<article class="answer" dir="auto"><p>${esc(r.answer || r.error?.message || (r.status === "pending" ? "Preparing your answer…" : "No answer was produced."))}</p>${r.example ? `<div class="example"><strong>Generated practice example</strong><p>${esc(r.example)}</p></div>` : ""}<div>${(r.sources || []).map((s) => `<button class="source-chip" data-source="${esc(s.id)}" data-request="${r.id}">▣ ${esc(s.filename)} · ${esc(s.locator)}</button>`).join("")}</div><small>${esc(r.status)}</small><div class="feedback"><button data-feedback="helpful" data-request="${r.id}" aria-label="Helpful response">♧ Helpful</button><button data-feedback="unhelpful" data-request="${r.id}">Not helpful</button><button data-feedback="issue" data-request="${r.id}">⚑ Report an issue</button></div></article>`;
}
function privacy(m) {
  const c = cfg(m);
  shell(
    `<article class="privacy"><a href="#/t/${m.id}">← Return to tutor</a><h1>Your questions & privacy</h1><h2>What is recorded</h2><p>Your question, tutor response, authenticated student ID, module and conversation identifiers, timestamp, request status, model and configuration versions, retrieved source excerpts, response time, returned token usage and feedback. We do not save hidden model reasoning or provider secrets in conversation records.</p><h2>Who can review it</h2><p>You can see your own history. The module owner and explicitly authorized collaborators can review module conversations to improve teaching. Platform administrators have explicit audited administrative privileges. Students cannot see one another’s conversations.</p><h2>Retention & deletion</h2><p>This module retains conversation records for ${c.retentionDays || 90} days after last activity; daily maintenance removes expired conversations. Deleting a conversation or an exchange removes it from your chat. Original and superseded exchanges remain in instructor review records under the module retention policy. You can export your questions or request permanent erasure below. Your instructor reviews erasure requests. Minimal audit metadata is retained for 365 days.</p><h2>What goes to the provider</h2><p>Voice recordings are sent to OpenAI for transcription; this app does not save audio. Original submitted text and English translations are retained with the conversation. Student documents are used for the attached question only; cited excerpts are retained and visible to authorized instructors, while the original file is not saved. The configured primary and backup providers may receive student questions, supporting excerpts and tutor instructions. OpenAI connections may also receive extracted text for embeddings. Direct student names and email addresses are not added to model prompts. Do not include unnecessary personal or sensitive data in your question. Provider retention depends on the service and account settings. <a href="https://developers.openai.com/api/docs/guides/your-data" target="_blank" rel="noopener">OpenAI data controls</a> describe applicable abuse monitoring and account-specific controls.</p><h2>How answers work</h2><p>Answers are generated from selected active module excerpts; the full collection is not sent with every question. Sources are checked against retrieved evidence, but citation relevance and factual accuracy are not guaranteed. Generated practice examples, when enabled by your instructor, are labelled separately. No conversations are automatically used for training or fine-tuning and published instructions are never automatically rewritten.</p><div class="actions"><button id="export-private">Export my questions</button><button id="erasure">Request permanent erasure</button></div></article>`,
    m,
  );
  $("#export-private").onclick = () => run(() => downloadExport(m.id));
  $("#erasure").onclick = () =>
    run(async () => {
      await api("requestDeletion", { module: m.id });
      notify("Your erasure request has been recorded for instructor review.");
    });
}
let renderSequence = 0;
function openStudent(m) {
  history.pushState(null, "", studentHref(m));
  run(render);
}
async function render() {
  if (!state.user) return login();
  const seq = ++renderSequence;
  const [kind, moduleId, tab] = location.hash.replace(/^#\//, "").split("/");
  const direct = /^\/ai-tutor\/([a-z0-9][a-z0-9_-]{0,63})\/?$/i.exec(location.pathname);
  if (direct && !location.hash) {
    const ending = direct[1].toLowerCase();
    let m = state.modules.find(x => x.slug === ending && x.published);
    if (!m) {
      try {
        const link = await api("resolveStudentLink", { ending });
        m = state.modules.find(x => x.id === link.id && x.published);
        if (m) m.slug = link.slug;
      } catch (error) {
        if (seq === renderSequence) {
          shell('<section class="card"><h1>Tutor unavailable</h1><p>' + esc(error.message) + '</p><a href="#/">Return to dashboard</a></section>');
        }
        return;
      }
    }
    if (seq !== renderSequence) return;
    if (!m) return dashboard();
    history.replaceState(null, "", studentPath(m.slug));
    return chat(m, false);
  }
  if (direct && location.hash) history.replaceState(null, "", tutorRoot + location.hash);
  if (!kind) return dashboard();
  if (kind === "create") return create();
  const m = state.modules.find((x) => x.id === moduleId);
  if (!m)
    throw Error(
      "This module is unavailable to your account. Ask your instructor to enroll you.",
    );
  if (seq !== renderSequence) return;
  if (kind === "admin") await admin(m, tab);
  else if (kind === "t" || kind === "preview") {
    if (kind === "t" && m.slug && m.published)
      history.replaceState(null, "", studentPath(m.slug));
    await chat(m, kind === "preview");
  }
  else if (kind === "privacy") privacy(m);
  else dashboard();
}
window.addEventListener("popstate", () => run(render));
async function init() {
  const c = window.TUTOR_CONFIG;
  if (c?.backendReady === false)
    return login(
      "Platform setup is in progress. Google sign-in will be available once backend deployment is complete.",
    );
  if (!c?.firebase?.apiKey || !c.firebase.projectId)
    return login("Google sign-in is awaiting platform configuration.");
  const base = "https://www.gstatic.com/firebasejs/12.19.0/";
  const [appSDK, authModule, functionsSDK, appCheckSDK] = await Promise.all(
    [
      "firebase-app.js",
      "firebase-auth.js",
      "firebase-functions.js",
      "firebase-app-check.js",
    ].map((p) => import(base + p)),
  );
  authSDK = authModule;
  const app = appSDK.initializeApp(c.firebase, "module-tutor");
  auth = authSDK.getAuth(app);
  if (c.appCheckSiteKey)
    appCheckSDK.initializeAppCheck(app, {
      provider: new appCheckSDK.ReCaptchaEnterpriseProvider(c.appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  else if (!c.emulator)
    throw Error("App Check must be configured before sign-in.");
  const functions = functionsSDK.getFunctions(app, c.region);
  if (c.emulator) {
    authSDK.connectAuthEmulator(auth, "http://localhost:9099");
    functionsSDK.connectFunctionsEmulator(functions, "localhost", 5001);
  }
  call = functionsSDK.httpsCallable(functions, "tutorApi", { timeout: 125000 });
  login();
  authSDK.onAuthStateChanged(auth, (user) =>
    run(async () => {
      authEpoch++;
      renderSequence++;
      state.chatModule = null;
      state.conversation = crypto.randomUUID();
      state.conversations = [];
      state.messages = [];
      state.pending = null;
      if (!user) {
        state.user = null;
        state.modules = [];
        state.messages = [];
        state.pending = null;
        return login();
      }
      try {
        await refresh();
        await render();
      } catch (e) {
        state.user = null;
        login(e.message);
      }
    }),
  );
}
init().catch((e) => login(e.message));
