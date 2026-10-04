"use strict";

const $ = (id) => document.getElementById(id);
const tokenInput = $("token");
const result = $("result");
const qrImg = $("qr");
const copyBtn = $("copy");
let pollTimer = null;

try {
  tokenInput.value = sessionStorage.getItem("pairToken") || "";
} catch {
  /* storage unavailable */
}
tokenInput.addEventListener("change", () => {
  try {
    sessionStorage.setItem("pairToken", tokenInput.value);
  } catch {
    /* storage unavailable */
  }
});

function setTab(mode) {
  const isCode = mode === "code";
  $("tab-code").classList.toggle("active", isCode);
  $("tab-qr").classList.toggle("active", !isCode);
  $("tab-code").setAttribute("aria-selected", String(isCode));
  $("tab-qr").setAttribute("aria-selected", String(!isCode));
  $("panel-code").hidden = !isCode;
  $("panel-qr").hidden = isCode;
  reset();
}

function reset() {
  clearInterval(pollTimer);
  result.className = "result";
  result.textContent = "";
  qrImg.hidden = true;
  copyBtn.hidden = true;
}

function showMessage(text, isError = false) {
  result.className = isError ? "result error" : "result";
  result.textContent = text;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", "X-Access-Token": tokenInput.value, ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

function poll(id) {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const status = await api(`/api/status/${encodeURIComponent(id)}`);
      if (status.qr && !qrImg.hidden) qrImg.src = status.qr;
      if (["delivered", "failed", "expired"].includes(status.state)) {
        clearInterval(pollTimer);
        qrImg.hidden = true;
        copyBtn.hidden = true;
        showMessage(status.message || status.state, status.state !== "delivered");
      }
    } catch (err) {
      clearInterval(pollTimer);
      showMessage(err.message, true);
    }
  }, 2000);
}

async function start(mode, button) {
  reset();
  if (!tokenInput.value) return showMessage("Enter the access token first.", true);
  button.disabled = true;
  showMessage("Contacting WhatsApp…");
  try {
    const body =
      mode === "code"
        ? await api("/api/pair", { method: "POST", body: JSON.stringify({ number: $("number").value }) })
        : await api("/api/qr", { method: "POST", body: "{}" });
    if (body.code) {
      result.className = "result";
      result.textContent = "";
      const span = document.createElement("span");
      span.className = "code";
      span.textContent = body.code;
      result.appendChild(span);
      copyBtn.hidden = false;
      copyBtn.onclick = () => navigator.clipboard?.writeText(body.code.replace(/-/g, ""));
    } else if (body.qr) {
      showMessage("Scan this QR code with WhatsApp.");
      qrImg.src = body.qr;
      qrImg.hidden = false;
    }
    poll(body.id);
  } catch (err) {
    showMessage(err.message, true);
  } finally {
    button.disabled = false;
  }
}

$("tab-code").addEventListener("click", () => setTab("code"));
$("tab-qr").addEventListener("click", () => setTab("qr"));
$("start-code").addEventListener("click", (e) => start("code", e.currentTarget));
$("start-qr").addEventListener("click", (e) => start("qr", e.currentTarget));
