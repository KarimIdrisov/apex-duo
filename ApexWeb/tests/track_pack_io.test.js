import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { slugify, writeTrack, buildIndex } from "../tools/track_pack_io.mjs";

test("slugify: transliterates Cyrillic, sanitizes, falls back", () => {
  assert.equal(slugify("Моя Трасса"), "moya-trassa");
  assert.equal(slugify("Spa 24!"), "spa-24");
  assert.equal(slugify(""), "track");
  assert.equal(slugify("***"), "track");
});

test("writeTrack: writes <slug>.json with a clean record; same name overwrites", () => {
  const dir = mkdtempSync(join(tmpdir(), "pack-"));
  try {
    const { slug, file } = writeTrack(dir, {
      name: "Моя", points: [0, 0, 1, 0, 1, 1, 0, 1],
      zones: [{ sectors: [0], ease: 0.5, type: "brake" }],
    });
    assert.equal(slug, "moya");
    assert.equal(file, "moya.json");
    const rec = JSON.parse(readFileSync(join(dir, "moya.json"), "utf8"));
    assert.equal(rec.name, "Моя");
    assert.deepEqual(rec.points, [0, 0, 1, 0, 1, 1, 0, 1]);
    assert.equal(rec.zones[0].type, "brake");
    assert.equal(rec.pit, null);
    writeTrack(dir, { name: "Моя", points: [9, 9, 9, 9, 9, 9, 9, 9] });
    const rec2 = JSON.parse(readFileSync(join(dir, "moya.json"), "utf8"));
    assert.deepEqual(rec2.points, [9, 9, 9, 9, 9, 9, 9, 9]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("writeTrack: rejects a record without enough points", () => {
  const dir = mkdtempSync(join(tmpdir(), "pack-"));
  try { assert.throws(() => writeTrack(dir, { name: "x", points: [0, 0] })); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("buildIndex: lists every track file (not index.json), sorted by name", () => {
  const dir = mkdtempSync(join(tmpdir(), "pack-"));
  try {
    writeTrack(dir, { name: "Яна", points: [0, 0, 1, 0, 1, 1, 0, 1] });
    writeTrack(dir, { name: "Аня", points: [0, 0, 1, 0, 1, 1, 0, 1] });
    const index = buildIndex(dir);
    assert.deepEqual(index.map((e) => e.name), ["Аня", "Яна"]);
    const onDisk = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
    assert.deepEqual(onDisk, index);
    assert.ok(!index.some((e) => e.slug === "index"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
