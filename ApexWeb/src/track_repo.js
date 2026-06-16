// ApexWeb/src/track_repo.js — thin HTTP client to the local editor helper (tools/editor_server.mjs).
// saveToRepo writes a repo file; publish git-pushes. Both degrade to {ok:false} when no helper is
// running (plain static hosting / GitHub Pages) so the editor never throws.
async function post(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) throw new Error("http " + res.status);
  return res.json();
}

// POST the track record; returns {ok:true, slug} or {ok:false, offline:true} if no helper.
export async function saveToRepo(record) {
  try {
    const r = await post("/api/save-track", { record });
    return { ok: true, slug: r.slug };
  } catch {
    return { ok: false, offline: true };
  }
}

// ask the helper to git add ApexWeb/tracks -> commit -> push; returns {ok, message}.
export async function publish() {
  try {
    const r = await post("/api/publish", {});
    return { ok: r.ok !== false, message: r.message || "" };
  } catch {
    return { ok: false, message: "нет node-сервера (запусти tools/editor_server.mjs)" };
  }
}
