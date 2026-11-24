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
  sources: [],
  acknowledged: false,
  pending: null,
};
let auth, authSDK, call;
let authEpoch = 0;
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
function shell(content, selected = null, student = false) {
  const visible = student
    ? state.modules.filter((m) => m.published)
    : state.modules;
  $("#app").innerHTML =
    `<div class="shell"><aside class="sidebar"><a href="#/" class="brand">Module Tutor</a>${visible.length ? `<label class="hidden" for="module-switch">Module</label><select id="module-switch"><option value="">Choose a module</option>${visible.map((m) => `<option value="${esc(m.id)}" ${m.id === selected?.id ? "selected" : ""}>${esc(cfg(m).title)}</option>`).join("")}</select>` : ""}${student ? '<button class="gold" id="new-conversation">＋ New conversation</button>' : ""}<nav><a href="#/">Dashboard</a>${state.user.instructor ? ' · <a href="#/create">Create tutor</a>' : ""}</nav>${student ? `<div class="history"><h3>Recent conversations</h3>${state.conversations.map((c) => `<button data-conversation="${esc(c.id)}" class="${c.id === state.conversation ? "active" : ""}">◯ ${esc(c.title)}</button>`).join("") || "<small>No conversations yet.</small>"}</div>` : ""}<div class="account"><div><strong>${esc(state.user.name)}</strong><br>${state.user.instructor ? "Instructor account" : "Student account"}</div><button id="signout">Sign out</button></div></aside><main class="main">${content}</main></div>`;
  $("#signout").onclick = () => run(() => authSDK.signOut(auth));
  const select = $("#module-switch");
  if (select)
    select.onchange = () => {
      if (select.value)
        location.hash = `/${student ? "t" : "admin"}/${select.value}`;
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
          return `<article class="card"><span class="pill">${esc(m.paused ? "Paused" : m.published ? "Published" : "Draft")}</span><p class="muted">${esc(c.code)}</p><h2>${esc(c.title)}</h2><p>${esc(c.name)}</p>${m.manage ? `<small>${esc(c.model || "Model not selected")} · ${m.lastActivity ? `Last activity ${new Date(m.lastActivity).toLocaleDateString("en-GB")}` : "No activity yet"}</small><div class="actions"><a class="button" href="#/admin/${m.id}">Configure</a><a class="button" href="#/preview/${m.id}">Preview</a><a class="button" href="#/admin/${m.id}/conversations">Conversations</a><a class="button" href="#/admin/${m.id}/analytics">Analytics</a></div>` : `<a class="button primary" href="#/t/${m.id}">Open tutor</a>`}</article>`;
        })
        .join("") ||
      `<div class="empty">${state.user.instructor ? "Create your first module tutor to get started." : "No modules are available yet. Ask your instructor to enroll the Google account you used to sign in."}</div>`
    }</div>${state.user.admin ? `<section class="card" style="margin-top:24px"><h2>Platform administration</h2><p>Role grants are recorded in the audit log.</p><form id="roles" class="form"><label>Google account email<input name="email" type="email" required></label><label>Role<select name="role"><option value="instructor">Instructor</option><option value="student">Student (revoke instructor role)</option><option value="admin">Platform administrator</option></select></label><button class="primary">Save role grant</button></form></section>` : ""}`,
  );
  document.querySelectorAll(".cards .card").forEach((card, index) => {
    const m = state.modules[index];
    if (!m.manage) return;
    card.querySelector(".pill").textContent =
      m.status || (m.paused ? "Paused" : m.published ? "Published" : "Draft");
    const meta = document.createElement("p");
    meta.className = "muted";
    meta.textContent = `${m.studentCount || 0} enrolled students · OpenAI`;
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
    `<h1>Create a module tutor</h1><p class="muted">Start with your module. Your progress is saved as a draft.</p><div class="stepper"><span class="active">1 Module details</span><span>2 Materials</span><span>3 Provider</span><span>4 Behavior</span><span>5 Publish</span></div><form id="create" class="form card">${details()}<button class="primary">Save draft & add materials →</button></form>`,
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
    content = `${modelGuidance()}<div class="warning">Requests and embeddings are charged to the instructor’s OpenAI account. Students never enter a key or select a model. Application quotas limit request counts; they are not a monetary billing cap.</div><form id="draft" class="form card"><label>Provider connection<select id="connection" name="connection" required><option value="">Choose a connection</option>${choices.map((x) => `<option value="${x.id}" ${x.id === c.connection ? "selected" : ""}>${esc(x.name)} · ${esc(x.masked)}</option>`).join("")}</select></label><label>Supported model<select name="model" id="model" required>${(selected?.models || []).map((x) => `<option ${x === c.model ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></label><button class="primary">Save draft selection</button></form><form id="connect" class="card form" style="margin-top:20px"><h2>OpenAI connection</h2>${input("Connection name", "name", "", "text", true)}${input("API key", "key", "", "password", true)}<label>Save as<select name="replace"><option value="">New connection</option>${choices.map((x) => `<option value="${x.id}">Replace ${esc(x.name)}</option>`).join("")}</select></label><small>Validated on the server and saved in Google Cloud Secret Manager. A saved key can never be shown again.</small><div class="actions"><button class="primary">Validate & save connection</button></div></form><h3>Your connections</h3>${state.connections.map((x) => `<p>${esc(x.name)} · ${esc(x.masked)} · ${x.revoked ? "Revoked" : `<button data-action="refreshConnection" data-connection="${x.id}">Refresh available models</button> <button data-action="revoke" data-connection="${x.id}">Revoke</button>`}</p>`).join("")}<p class="muted">Anthropic: unavailable in this pilot. Google Gemini: unavailable in this pilot.</p>`;
  }
  if (tab === "access") {
    const roster = await api("roster", { module: m.id });
    content = `<div class="card form"><h2>Enroll Google accounts</h2><p>A tutor link alone does not grant access. Personal and Workspace Google accounts, including UCD accounts, are supported.</p><form id="enroll">${input("Student Google email", "email", "", "email", true)}<button class="primary">Enroll student</button></form></div><h3>${roster.filter((x) => x.active).length} enrolled students</h3><div class="scroll"><table><tbody>${roster.map((x) => `<tr><td>${esc(x.email)}</td><td>${x.active ? "Enrolled" : "Removed"}</td><td>${x.active ? `<button data-action="unenroll" data-email="${esc(x.email)}">Remove access</button>` : ""}</td></tr>`).join("")}</tbody></table></div><form id="collaborate" class="card form" style="margin-top:20px"><h3>Collaborator access</h3><p>Only the owner can grant a collaborator. Use their Firebase user ID after they sign in.</p>${input("Collaborator user ID", "uid", "", "text", true)}<button>Add collaborator</button></form>`;
  }
  if (tab === "publish")
    content = `<section class="card form"><h2>Test, then publish</h2><p>Draft changes do not alter the published tutor. All student materials must be ready, with an active provider connection and supported model.</p><p>Current publication: ${m.published ? `version ${m.version}` : "Not published"}</p><div class="actions"><a class="button" href="#/preview/${m.id}">Test draft</a><button class="primary" data-action="publish">Publish new version</button><button data-action="pause">${m.paused ? "Resume tutor" : "Pause tutor"}</button></div>${m.published ? `<label>Student link<input readonly value="${esc(`${location.origin}/ai-tutor/#/t/${m.id}`)}"></label>` : ""}</section>`;
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
      ["Insufficient evidence", a.insufficient],
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
  if ($("#draft"))
    $("#draft").onsubmit = (e) => {
      e.preventDefault();
      run(async () => {
        const fd = new FormData(e.target);
        const update = Object.fromEntries(fd);
        if (tab === "behavior") {
          update.starters = String(update.starters).split("\n").filter(Boolean);
          update.hints = fd.has("hints");
          update.examples = fd.has("examples");
        }
        await api("saveDraft", {
          module: m.id,
          config: { ...m.draft, ...update },
        });
        await refresh();
        notify(
          "Draft saved. Publish it when you are ready for students to use these changes.",
        );
        await render();
      }, e.submitter);
    };
  if ($("#connection"))
    $("#connection").onchange = (e) => {
      $("#model").innerHTML = (
        state.connections.find((x) => x.id === e.target.value)?.models || []
      )
        .map((v) => `<option>${esc(v)}</option>`)
        .join("");
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
function modelGuidance() {
  return `<section class="card"><h2>Choose a tutor model</h2><p><strong>Guidance and standard API prices checked 24 November 2026.</strong> Prices below are USD per one million tokens, with uncached input and standard processing. Check the linked current rates before budgeting.</p><div class="scroll"><table><thead><tr><th>Model</th><th>Suggested use</th><th>Input</th><th>Output</th></tr></thead><tbody><tr><td>GPT-6.2 Sol</td><td>Suggested starting point for everyday course tutoring, hints and multilingual conversations, including Chinese. Validate with representative course questions.</td><td>$2</td><td>$10</td></tr><tr><td>GPT-6.2 Astra</td><td>OpenAI’s most capable model; consider for difficult reasoning, nuanced explanations and demanding courses. Multilingual support alone does not require it.</td><td>$8</td><td>$40</td></tr></tbody></table></div><p>Both models support multilingual text. Voice dictation uses the separate GPT-Transcribe model to recognize the original language; the tutor then replies in that language and adds English translations. No Chinese-specific tutor model is needed.</p><p>Illustration: 3,000 input tokens and 1,000 billed output tokens cost about $0.016 with Sol or $0.064 with Astra per question (about $16 / $64 for 1,000 such questions). This is arithmetic, not a measured average or spending cap. Retrieved documents add input; reasoning tokens and English translations add billed output. Non-English text can use different token counts. Transcription, document embeddings, Firebase, taxes and any regional surcharges are additional. GPT-Transcribe is $0.0045 per audio minute ($0.27 per hour), checked on the same date; this is additional to tutor text costs.</p><p>Our recommendation: start with Sol, test Chinese and your course’s hardest questions, and compare answers before choosing Astra. Existing published selections change only when you save and publish. Older GPT-4.1 options remain for existing modules; this guidance focuses on the current models. Availability depends on your OpenAI project.</p><p><a href="https://developers.openai.com/api/docs/models" target="_blank" rel="noopener">OpenAI model capabilities</a> · <a href="https://developers.openai.com/api/docs/pricing" target="_blank" rel="noopener">Current OpenAI pricing</a> · <a href="https://developers.openai.com/api/docs/models/gpt-transcribe" target="_blank" rel="noopener">Transcription pricing</a> · <a href="https://developers.openai.com/api/docs/guides/speech-to-text" target="_blank" rel="noopener">Multilingual transcription</a></p></section>`;
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
          `<div class="record"><small>${new Date(r.at).toLocaleString("en-GB")} · ${esc(r.status)} · ${esc(r.model)} · configuration ${esc(r.configVersion)} · index ${esc(r.materialVersion)}</small><h3>Student question</h3><p>${esc(r.question)}</p>${englishMarkup(r)}<h3>Tutor response</h3><p>${esc(r.answer || r.error?.message || "Pending")}</p>${(r.sources || []).map((s) => `<button class="source-chip" data-review-source="${esc(s.id)}" data-request="${r.id}" data-conversation="${conversation}">${esc(s.filename)} · ${esc(s.locator)}</button>`).join("")}<p><small>${esc(r.feedback?.rating || "No feedback")} ${esc(r.feedback?.issue || "")}</small></p></div>`,
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
async function chat(m, preview = false) {
  const config = preview ? m.draft : m.published;
  if (!config) throw Error("This tutor is not published.");
  if (state.chatModule !== m.id || state.preview !== preview) {
    state.conversation = crypto.randomUUID();
    state.messages = [];
    state.sources = [];
    state.chatModule = m.id;
    state.preview = preview;
    state.pending = null;
    state.acknowledged = false;
  }
  state.conversations = await api("conversations", { module: m.id });
  shell(
    `<div class="chat-layout"><section class="chat"><header class="topline"><div><h1>${esc(config.title)}</h1><p class="muted">Your course tutor · Instructor: ${esc(m.instructor)}</p></div><span class="pill">▣ Based on module materials</span></header>${preview ? `<div class="warning">Instructor draft preview. Questions and responses are recorded as preview activity. <a href="#/admin/${m.id}/publish">Return to publication</a></div>` : ""}${m.paused ? '<div class="warning">Your instructor has paused this tutor.</div>' : ""}<div class="starters"><button data-starter="Explain a concept">♧ Explain a concept</button><button data-starter="Give me a hint">♧ Give me a hint</button><button data-starter="Quiz me">☷ Quiz me</button></div><div id="messages" class="messages" aria-live="polite">${state.messages.length ? "" : `<div class="empty"><h2>${esc(config.name)}</h2><p>${esc(config.welcome)}</p>${config.starters.map((q) => `<button data-starter="${esc(q)}">${esc(q)}</button>`).join(" ")}</div>`}${state.messages.map((r) => messageMarkup(r)).join("")}</div><div class="disclosure"><label class="check"><input id="ack" type="checkbox" ${state.acknowledged ? "checked" : ""}> <span>Your questions and tutor responses are saved. Your instructor can review them to improve this module’s tutor. <a href="#/privacy/${m.id}">Privacy details</a></span></label></div><div class="actions"><button id="dictate" type="button">🎙 Speak your question</button><label>Or transcribe a recording<input id="voice-file" type="file" accept="audio/webm,audio/mp4,audio/ogg,audio/wav,audio/mpeg"></label><label>Attach a document<input id="student-file" type="file" accept=".pdf,.docx,.pptx,.txt,.md"></label></div><p id="voice-status" role="status">Speak or type in your language. The tutor replies in that language, with English translations. Attach one document up to 4 MB for this question.</p><form id="ask" class="composer"><label class="hidden" for="question">Ask about your module</label><textarea id="question" maxlength="4000" required placeholder="Ask about your module…" ${m.paused ? "disabled" : ""}></textarea><button class="primary" aria-label="Send question" ${m.paused ? "disabled" : ""}>➤</button></form><p class="ai-note">AI can make mistakes. Check the cited sources.</p><div class="actions"><button id="export-own">Export my questions</button><button id="hide">Hide this conversation</button></div></section><aside class="sources"><h2>Sources for this answer</h2>${state.sources.map((s) => `<button class="source-card" data-source="${esc(s.id)}" data-request="${esc(state.sourceRequest)}"><strong>▤ ${esc(s.filename)} · ${esc(s.locator)}</strong><blockquote>${esc(s.text.slice(0, 240))}…</blockquote></button>`).join("") || '<p class="muted">Supporting excerpts will appear here when you ask a question.</p>'}</aside></div>`,
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
  $("#voice-file").onchange = e => run(async () => {
    const file = e.target.files[0];
    if (!file) return;
    if (!state.acknowledged) throw Error("Acknowledge the recording notice first. Audio is sent to OpenAI and is not saved by this app.");
    if (file.size > 2 * 1024 * 1024) throw Error("Recording exceeds 2 MB.");
    const box = $("#question"), status = $("#voice-status");
    status.textContent = "Transcribing recording…";
    const mime = file.type.split(";")[0].replace("audio/x-wav", "audio/wav");
    try {
      const result = await api("transcribe", { module: m.id, preview, acknowledged: true, mime, audio: await blobBase64(file) });
      if (!box.isConnected) return;
      box.value = (box.value + " " + result.text).trim(); box.focus();
      status.textContent = "Review or edit your transcript, then send. English translations appear with the reply.";
    } catch (error) { status.textContent = "Transcription failed. Please try again or type your question."; throw error; }
    finally { e.target.value = ""; }
  });
  let recording = null;
  $("#dictate").onclick = () => run(async () => {
    if (recording) { recording.stop(); return; }
    if (!state.acknowledged) throw Error("Acknowledge the recording notice first. Audio is sent to OpenAI for transcription and is not saved by this app.");
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
      const box = $("#question"), status = $("#voice-status"), button = $("#dictate");
      if (!box?.isConnected) return;
      button.textContent = "🎙 Speak your question"; button.disabled = true; status.textContent = "Transcribing…";
      run(async () => {
        try {
          const audio = await blobBase64(new Blob(parts, { type: mime }));
          const result = await api("transcribe", { module: m.id, preview, acknowledged: true, mime, audio });
          if (!box.isConnected) return;
          box.value = (box.value + " " + result.text).trim(); box.focus();
          status.textContent = "Review or edit your transcript, then send. English translations appear with the reply.";
        } catch (error) { status.textContent = "Transcription failed. Please try again or type your question."; throw error; } finally { button.disabled = false; }
      });
    };
    recorder.start(1000); $("#dictate").textContent = "Stop recording";
    $("#voice-status").textContent = "Listening… Stop when finished (maximum 60 seconds). Audio will be sent to OpenAI. Your instructor can review the submitted text.";
  });
  $("#ack").onchange = (e) => (state.acknowledged = e.target.checked);
  $("#new-conversation").onclick = () => {
    state.conversation = crypto.randomUUID();
    state.messages = [];
    state.sources = [];
    state.pending = null;
    run(() => chat(m, preview));
  };
  document.querySelectorAll("[data-conversation]").forEach(
    (b) =>
      (b.onclick = () =>
        run(async () => {
          state.conversation = b.dataset.conversation;
          state.pending = null;
          state.messages = await api("messages", {
            module: m.id,
            conversation: state.conversation,
          });
          state.sources = [];
          await chat(m, preview);
        })),
  );
  $("#ask").onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      if (!state.acknowledged)
        throw Error(
          "Please acknowledge the recording notice before your first question.",
        );
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
      state.pending = { request, question, attachments };
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
          acknowledged: true,
          preview,
        });
        const saved = { ...r, question };
        state.messages = state.messages.filter((x) => x.id !== request);
        state.messages.push(saved);
        state.pending = null;
        state.sources = r.sources || [];
        state.sourceRequest = request;
        await chat(m, preview);
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
  $("#export-own").onclick = () => run(() => downloadExport(m.id));
  $("#hide").onclick = () =>
    run(async () => {
      notify(
        (
          await api("hideConversation", {
            module: m.id,
            conversation: state.conversation,
          })
        ).notice,
      );
      state.conversation = crypto.randomUUID();
      state.messages = [];
      state.sources = [];
      await chat(m, preview);
    });
  if (state.pending) $("#question").value = state.pending.question;
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
  return `<div class="question" dir="auto">${esc(r.question)}${(r.attachments || []).map(f => `<small> · ${esc(f.filename)} (student upload)</small>`).join("")}</div>${englishMarkup(r)}<article class="answer" dir="auto"><p>${esc(r.answer || r.error?.message || (r.status === "pending" ? "Preparing your answer…" : "No answer was produced."))}</p>${r.example ? `<div class="example"><strong>Generated practice example</strong><p>${esc(r.example)}</p></div>` : ""}<div>${(r.sources || []).map((s) => `<button class="source-chip" data-source="${esc(s.id)}" data-request="${r.id}">▣ ${esc(s.filename)} · ${esc(s.locator)}</button>`).join("")}</div><small>${esc(r.status)}${r.insufficient ? " · Insufficient evidence" : ""}</small><div class="feedback"><button data-feedback="helpful" data-request="${r.id}" aria-label="Helpful response">♧ Helpful</button><button data-feedback="unhelpful" data-request="${r.id}">Not helpful</button><button data-feedback="issue" data-request="${r.id}">⚑ Report an issue</button></div></article>`;
}
function privacy(m) {
  const c = cfg(m);
  shell(
    `<article class="privacy"><a href="#/t/${m.id}">← Return to tutor</a><h1>Your questions & privacy</h1><h2>What is recorded</h2><p>Your question, tutor response, authenticated student ID, module and conversation identifiers, timestamp, request status, model and configuration versions, retrieved source excerpts, response time, returned token usage and feedback. We do not save hidden model reasoning or provider secrets in conversation records.</p><h2>Who can review it</h2><p>You can see your own history. The module owner and explicitly authorized collaborators can review module conversations to improve teaching. Platform administrators have explicit audited administrative privileges. Students cannot see one another’s conversations.</p><h2>Retention & deletion</h2><p>This module retains conversation records for ${c.retentionDays || 90} days after last activity; daily maintenance removes expired conversations. Hiding a conversation removes it from your visible history while retaining the instructor review record. You can export your questions or request permanent erasure below. Your instructor reviews erasure requests. Minimal audit metadata is retained for 365 days.</p><h2>What goes to the provider</h2><p>Voice recordings are sent to OpenAI for transcription; this app does not save audio. Original submitted text and English translations are retained with the conversation. Student documents are used for the attached question only; cited excerpts are retained and visible to authorized instructors, while the original file is not saved. OpenAI receives extracted text for embeddings, student questions for retrieval and generation, selected supporting excerpts, and tutor instructions. Direct student names and email addresses are not added to model prompts. Do not include unnecessary personal or sensitive data in your question. Responses use store:false; this is not a promise of zero provider retention. <a href="https://developers.openai.com/api/docs/guides/your-data" target="_blank" rel="noopener">OpenAI data controls</a> describe applicable abuse monitoring and account-specific controls.</p><h2>How answers work</h2><p>Answers are generated from selected active module excerpts; the full collection is not sent with every question. Sources are checked against retrieved evidence, but citation relevance and factual accuracy are not guaranteed. Generated practice examples, when enabled by your instructor, are labelled separately. No conversations are automatically used for training or fine-tuning and published instructions are never automatically rewritten.</p><div class="actions"><button id="export-private">Export my questions</button><button id="erasure">Request permanent erasure</button></div></article>`,
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
async function render() {
  if (!state.user) return login();
  const seq = ++renderSequence;
  const [kind, moduleId, tab] = location.hash.replace(/^#\//, "").split("/");
  if (!kind) return dashboard();
  if (kind === "create") return create();
  const m = state.modules.find((x) => x.id === moduleId);
  if (!m)
    throw Error(
      "This module is unavailable to your account. Ask your instructor to enroll you.",
    );
  if (seq !== renderSequence) return;
  if (kind === "admin") await admin(m, tab);
  else if (kind === "t" || kind === "preview")
    await chat(m, kind === "preview");
  else if (kind === "privacy") privacy(m);
  else dashboard();
}
window.addEventListener("hashchange", () => run(render));
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
      state.chatModule = null;
      state.conversation = crypto.randomUUID();
      state.conversations = [];
      state.messages = [];
      state.sources = [];
      state.acknowledged = false;
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
