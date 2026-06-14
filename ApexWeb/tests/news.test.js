import { test } from "node:test";
import assert from "node:assert/strict";
import { NEWS_CAP, pushNews, boardReaction, confidenceDelta } from "../src/news.js";

test("pushNews prepends newest-first and caps the inbox", () => {
  const c = {};
  for (let i = 0; i < NEWS_CAP + 5; i++) pushNews(c, "m" + i);
  assert.equal(c.news.length, NEWS_CAP);
  assert.equal(c.news[0], "m" + (NEWS_CAP + 4));      // newest first
});

test("boardReaction reads pleased above target, unhappy below; podium is glowing", () => {
  assert.match(boardReaction(2, 6, "GP"), /восторге|подиум/i);
  assert.match(boardReaction(5, 6, "GP"), /доволен/i);
  assert.match(boardReaction(12, 6, "GP"), /недоволен/i);
});

test("confidenceDelta is positive when beating target, negative when missing badly", () => {
  assert.ok(confidenceDelta(1, 6) > 0);
  assert.ok(confidenceDelta(6, 6) > 0);
  assert.ok(confidenceDelta(12, 6) < 0);
  assert.ok(confidenceDelta(20, 6) <= confidenceDelta(8, 6));
});
