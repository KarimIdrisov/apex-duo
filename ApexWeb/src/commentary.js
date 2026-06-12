// ApexWeb/src/commentary.js — pure: turn a structured sim event into a Russian radio line.
// Deterministic variety: the template is chosen by a stable hash of the event (no RNG).

const COMP_RU = { soft: "софт", medium: "медиум", hard: "хард", inter: "интер", wet: "дождевые" };

function fmtLap(t) {
  if (!t && t !== 0) return "";
  const m = Math.floor(t / 60), s = (t - m * 60).toFixed(3).padStart(6, "0");
  return m > 0 ? `${m}:${s}` : `${t.toFixed(3)}`;
}

// stable index into a template list, from the event's own fields (no Math.random)
function pick(ev, n) {
  const key = (ev.lap | 0) * 7 + (ev.a | 0) * 13 + (ev.b | 0) * 17 + (ev.type ? ev.type.length : 0);
  return ((key % n) + n) % n;
}

const T = {
  start: ["Огни погасли — поехали!", "Старт! Гонка началась.", "Поехали — лайтс аут!"],
  pass: ["{a} обходит {b}!", "{a} проходит {b} — отличный манёвр!", "Обгон! {a} впереди {b}.", "{a} дожимает {b} и выходит вперёд!"],
  pass_brake: ["{a} обходит {b} на торможении!", "Поздний тормоз — {a} переигрывает {b}!", "{a} ныряет внутрь под торможение и опережает {b}!"],
  pass_slip: ["{a} ловит выхлоп и проходит {b}!", "В слипстриме {a} опережает {b}!", "{a} выстреливает на прямой мимо {b}!"],
  pit: ["{a} ныряет в боксы — свежие {c}.", "Пит-стоп {a}: ставят {c}.", "{a} на пит-лейне, переобувается в {c}."],
  fastlap: ["Быстрейший круг — {a}! ({t})", "{a} ставит лучшее время круга — {t}.", "Феноменально от {a}: быстрейший круг {t}!"],
  dnf: ["{a} сходит с гонки!", "Сход: {a} остановился.", "{a} выбывает — DNF."],
  sc_on: ["🟡 Сейфти-кар на трассе!", "Жёлтые флаги — выехал сейфти-кар.", "Безопасность: машина безопасности на трассе."],
  sc_off: ["Сейфти-кар уходит — гонка возобновляется!", "Зелёный флаг — погнали!", "Рестарт! Сейфти-кар в боксах."],
  finish: ["🏁 {a} выигрывает Гран-при!", "Клетчатый флаг — победа {a}!", "{a} первым пересекает финишную черту! 🏁"],
};

export function describe(ev) {
  if (!ev || !T[ev.type]) return "";
  const key = (ev.type === "pass" && ev.zone && T["pass_" + ev.zone]) ? "pass_" + ev.zone : ev.type;
  const list = T[key];
  let s = list[pick(ev, list.length)];
  return s.replace("{a}", ev.abbr || "").replace("{b}", ev.abbrB || "")
          .replace("{c}", COMP_RU[ev.compound] || ev.compound || "")
          .replace("{t}", fmtLap(ev.t));
}
