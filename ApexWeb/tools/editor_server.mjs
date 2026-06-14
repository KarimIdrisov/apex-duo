// ApexWeb/tools/editor_server.mjs — localhost dev server for the track editor: serves ApexWeb/ as
// static files AND accepts the editor's Save (writes a repo file) + Опубликовать (git push). Run this
// instead of `python -m http.server` while authoring tracks. No npm deps. Binds 127.0.0.1 only.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { writeTrack, buildIndex } from "./track_pack_io.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));   // ApexWeb/
const REPO = join(ROOT, "..");                                // repo root (for git)
const TRACKS = join(ROOT, "tracks");
const PORT = Number(process.env.PORT) || 8000;
const TYPES = {
  ".html":"text/html", ".js":"text/javascript", ".mjs":"text/javascript", ".json":"application/json",
  ".css":"text/css", ".svg":"image/svg+xml", ".png":"image/png", ".ico":"image/x-icon",
};

const readBody = (req) => new Promise((res) => { let b = ""; req.on("data", (c) => b += c); req.on("end", () => res(b)); });
const sendJson = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

// git add ApexWeb/tracks (explicit pathspec — never -A) -> commit -> push. "nothing to commit" is a friendly no-op.
function gitPublish(done) {
  const run = (args) => new Promise((resolve, reject) =>
    execFile("git", args, { cwd: REPO }, (err, out, errout) => err ? reject(new Error(errout || err.message)) : resolve(out)));
  (async () => {
    try {
      await run(["add", "ApexWeb/tracks"]);
      try { await run(["commit", "-m", "chore(tracks): publish track pack"]); }
      catch (e) { if (/nothing to commit/i.test(e.message)) return done({ ok: true, message: "нечего публиковать (нет изменений)" }); throw e; }
      await run(["push"]);
      done({ ok: true, message: "опубликовано" });
    } catch (e) { done({ ok: false, message: String(e.message || e).split("\n")[0] }); }
  })();
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/save-track") {
      const { record } = JSON.parse(await readBody(req) || "{}");
      const { slug } = writeTrack(TRACKS, record);
      buildIndex(TRACKS);
      return sendJson(res, 200, { ok: true, slug });
    }
    if (req.method === "POST" && req.url === "/api/publish") {
      buildIndex(TRACKS);                                  // make sure the manifest reflects disk before committing
      return gitPublish((r) => sendJson(res, 200, r));
    }
    let url = (req.url || "/").split("?")[0];
    if (url === "/") url = "/index.html";
    const file = join(ROOT, normalize(decodeURIComponent(url)));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end("forbidden"); }   // path-traversal guard
    const data = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch (e) {
    if (e && e.code === "ENOENT") { res.writeHead(404); res.end("not found"); }
    else { sendJson(res, 500, { ok: false, message: String((e && e.message) || e) }); }
  }
});

server.listen(PORT, "127.0.0.1", () =>
  console.log(`editor server: http://127.0.0.1:${PORT}  (serving ApexWeb/, POST /api/save-track, POST /api/publish)`));
