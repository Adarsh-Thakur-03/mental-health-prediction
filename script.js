"use strict";

/* ---------- Config ---------- */
const API_URL = "https://mental-health-prediction-9lsj.onrender.com";
const NUMERIC_FIELDS = [
  "age", "avg_daily_usage_hours", "Daily_Unlocks",
  "physical_activity_hours", "sleep_hours_per_night", "study_hours",
];
// Score range used only for the visual gauge. Adjust if your target uses another scale.
const SCORE_MAX = 10;

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const form = $("predictForm");
const submitBtn = $("submitBtn");
const alertBox = $("alert");
const panels = { placeholder: $("placeholder"), loading: $("loading"), result: $("result") };

/* ---------- UI helpers ---------- */
function showPanel(name) {
  Object.entries(panels).forEach(([k, el]) => (el.hidden = k !== name));
}
function setLoading(on) {
  submitBtn.disabled = on;
  submitBtn.classList.toggle("loading", on);
  submitBtn.querySelector(".btn-label").textContent = on ? "Predicting…" : "Predict score";
}
function showAlert(msg) { alertBox.textContent = msg; alertBox.hidden = false; }
function clearErrors() {
  alertBox.hidden = true;
  document.querySelectorAll(".err").forEach((e) => (e.textContent = ""));
  document.querySelectorAll(".field").forEach((f) => f.classList.remove("invalid"));
}
function setFieldError(name, msg) {
  const el = document.querySelector(`[data-err="${name}"]`);
  if (!el) return false;
  el.textContent = msg;
  el.closest(".field").classList.add("invalid");
  return true;
}

/* ---------- Build payload + client validation ---------- */
function buildPayload() {
  const payload = {};
  let valid = true;
  for (const el of form.elements) {
    if (!el.name) continue;
    const raw = el.value.trim();
    if (raw === "") { setFieldError(el.name, "This field is required"); valid = false; continue; }
    if (NUMERIC_FIELDS.includes(el.name)) {
      const num = Number(raw);
      if (Number.isNaN(num)) { setFieldError(el.name, "Enter a valid number"); valid = false; continue; }
      if (el.min !== "" && num < Number(el.min)) { setFieldError(el.name, `Must be at least ${el.min}`); valid = false; continue; }
      if (el.max !== "" && num > Number(el.max)) { setFieldError(el.name, `Must be at most ${el.max}`); valid = false; continue; }
      payload[el.name] = num;
    } else {
      payload[el.name] = raw;
    }
  }
  return valid ? payload : null;
}

/* ---------- Response parsing ---------- */
function extractScore(data) {
  if (data && typeof data.prediction_mental_health_score === "number") return data.prediction_mental_health_score;
  if (typeof data === "number") return data;
  if (data && typeof data === "object") {
    const preferred = Object.keys(data).find((k) => /score|predict|result|mental/i.test(k) && !isNaN(parseFloat(data[k])));
    if (preferred) return parseFloat(data[preferred]);
    const anyNum = Object.values(data).find((v) => typeof v === "number");
    if (anyNum !== undefined) return anyNum;
  }
  if (typeof data === "string" && !isNaN(parseFloat(data))) return parseFloat(data);
  return null;
}

function describe(score) {
  const pct = score / SCORE_MAX;
  if (pct >= 0.7) return { label: "Good", color: "var(--good)", msg: "Indicators point to a healthy mental wellbeing balance. Keep up your routines!" };
  if (pct >= 0.45) return { label: "Moderate", color: "var(--mid)", msg: "There's room for improvement. Better sleep, activity and less screen time can help." };
  return { label: "Needs attention", color: "var(--bad)", msg: "Several factors suggest elevated risk. Consider healthier habits and talking to someone you trust." };
}

/* ---------- Render result ---------- */
function renderResult(score) {
  const info = describe(score);
  const bar = $("gaugeBar");
  const circumference = 2 * Math.PI * 52;
  const ratio = Math.max(0, Math.min(1, score / SCORE_MAX));

  $("scoreLabel").textContent = info.label;
  $("scoreLabel").style.background = info.color;
  $("scoreMsg").textContent = info.msg;
  bar.style.stroke = info.color;
  bar.style.strokeDashoffset = circumference;
  showPanel("result");

  requestAnimationFrame(() => requestAnimationFrame(() => {
    bar.style.strokeDashoffset = circumference * (1 - ratio);
  }));

  // count-up animation
  const el = $("scoreValue");
  const start = performance.now(), dur = 1200;
  (function tick(now) {
    const t = Math.min(1, (now - start) / dur);
    el.textContent = (score * (1 - Math.pow(1 - t, 3))).toFixed(2);
    if (t < 1) requestAnimationFrame(tick);
  })(start);
}

/* ---------- Error handling ---------- */
function handleValidationError(detail) {
  // FastAPI 422 -> detail: [{loc:["body","Age"], msg:"...", type:"..."}]
  if (!Array.isArray(detail)) { showAlert(String(detail)); return; }
  const unmatched = [];
  detail.forEach((d) => {
    const field = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : null;
    if (!setFieldError(field, d.msg)) unmatched.push(`${field ?? "request"}: ${d.msg}`);
  });
  showAlert(unmatched.length ? unmatched.join(" • ") : "Please correct the highlighted fields.");
}

/* ---------- Submit ---------- */
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearErrors();

  const payload = buildPayload();
  if (!payload) { showAlert("Please fix the highlighted fields."); return; }

  setLoading(true);
  showPanel("loading");

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    let data = null;
    try { data = await res.json(); } catch { /* non-JSON body */ }

    if (res.status === 422) { handleValidationError(data?.detail); showPanel("placeholder"); return; }
    if (!res.ok) {
      const detail = typeof data?.detail === "string" ? data.detail : `Server error (${res.status}).`;
      throw new Error(detail);
    }

    const score = extractScore(data);
    if (score === null) throw new Error("The API response did not contain a numeric score.");
    renderResult(score);
  } catch (err) {
    showPanel("placeholder");
    if (err instanceof TypeError) {
      showAlert("Cannot reach the API at " + API_URL + ". Make sure uvicorn is running (and CORS is enabled if the page is served from another origin).");
    } else {
      showAlert(err.message || "Something went wrong. Please try again.");
    }
  } finally {
    setLoading(false);
  }
});

/* ---------- Reset ---------- */
$("resetBtn").addEventListener("click", () => {
  form.reset();
  clearErrors();
  showPanel("placeholder");
});

/* Clear a field's error as soon as the user edits it */
form.addEventListener("input", (e) => {
  const f = e.target.closest(".field");
  if (f) { f.classList.remove("invalid"); f.querySelector(".err").textContent = ""; }
});
