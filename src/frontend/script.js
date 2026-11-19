let currentQrData = null;
let isUrlSaved = false;
let debounceTime = 300;
let hasGeneratedFirstQR = false;
let turnstileToken = null;
let turnstileConsumed = false;

async function initTurnstile() {
  if (typeof turnstile === "undefined") {
    setTimeout(initTurnstile, 100);
    return;
  }
  try {
    const res = await fetch("/api/config");
    const { sitekey } = await res.json();
    if (!sitekey) {
      console.error("Turnstile sitekey missing");
      return;
    }
    const container = document.getElementById("cf-turnstile");
    if (!container) return;
    container.innerHTML = "";
    turnstile.render("#cf-turnstile", {
      sitekey,
      appearance: "always",
      callback: (token) => {
        turnstileToken = token;
        turnstileConsumed = false;
        document.getElementById("captcha-error").style.display = "none";
      },
      "error-callback": () => {
        turnstileToken = null;
      },
      "expired-callback": () => {
        turnstileToken = null;
      },
    });
  } catch (err) {
    console.error("Failed to initialize Turnstile:", err);
  }
}

window.onTurnstileLoad = function () {
  initTurnstile();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    if (typeof turnstile !== "undefined") initTurnstile();
  });
} else {
  if (typeof turnstile !== "undefined") initTurnstile();
}

function debounce(func, delay) {
  clearTimeout(debounce.timer);
  debounce.timer = setTimeout(func, delay);
}

function isValidHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function getTurnstileToken() {
  if (turnstileToken && !turnstileConsumed) return turnstileToken;
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const interval = setInterval(() => {
      if (turnstileToken && !turnstileConsumed) {
        clearInterval(interval);
        resolve(turnstileToken);
      } else if (++attempts > 100) {
        clearInterval(interval);
        reject(new Error("CAPTCHA timeout"));
      }
    }, 100);
  });
}

async function generateShortUrl(input) {
  const format = document.getElementById("format").value;
  let cfToken;
  try {
    cfToken = await getTurnstileToken();
  } catch {
    document.getElementById("captcha-error").style.display = "block";
    return { error: "Captcha required" };
  }

  const res = await fetch("/api/generateShortenedUrl", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: input, format, cfToken }),
  });

  const data = await res.json();
  turnstileConsumed = true;
  if (typeof turnstile !== "undefined") {
    turnstile.reset("#cf-turnstile");
  }
  return data;
}

async function updateQRCode() {
  const input = document.getElementById("qr-input").value.trim();
  const format = document.getElementById("format").value;
  const img = document.getElementById("qr-code");
  const downloadBtn = document.getElementById("download-btn");
  const urlInfo = document.getElementById("url-info");
  const originalUrlSpan = document.getElementById("original-url");
  const shortUrlSpan = document.getElementById("short-url");
  const errorMessage = document.getElementById("error-message");

  errorMessage.style.display = "none";

  if (!input) {
    img.style.display = "none";
    img.classList.remove("fade-in");
    downloadBtn.classList.add("hidden");
    urlInfo.classList.add("hidden");
    return;
  }

  if (!isValidHttpUrl(input)) {
    errorMessage.style.display = "block";
    img.style.display = "none";
    img.classList.remove("fade-in");
    downloadBtn.classList.add("hidden");
    urlInfo.classList.add("hidden");
    return;
  }

  currentQrData = await generateShortUrl(input);
  isUrlSaved = false;

  if (currentQrData && currentQrData.qrSvg) {
    if (currentQrData.qrPng) img.dataset.png = currentQrData.qrPng;
    img.dataset.svg = currentQrData.qrSvg;
    img.src = format === "svg" || !currentQrData.qrPng ? currentQrData.qrSvg : currentQrData.qrPng;
    img.style.display = "block";
    img.classList.add("fade-in");
    downloadBtn.classList.remove("hidden");

    originalUrlSpan.textContent = input;
    shortUrlSpan.textContent = currentQrData.fullUrl;
    urlInfo.classList.remove("hidden");
  } else {
    errorMessage.style.display = "block";
  }
}

document.getElementById("format").addEventListener("change", () => {
  const img = document.getElementById("qr-code");
  const format = document.getElementById("format").value;
  if (img.dataset.svg || img.dataset.png) {
    img.src = format === "svg" || !img.dataset.png ? img.dataset.svg : img.dataset.png;
  }
});

document.getElementById("qr-input").addEventListener("input", () => {
  currentQrData = null;
  isUrlSaved = false;
  turnstileToken = null;
  turnstileConsumed = false;
  if (typeof turnstile !== "undefined") {
    turnstile.reset("#cf-turnstile");
  }

  debounce(() => {
    updateQRCode();
    if (!hasGeneratedFirstQR) {
      hasGeneratedFirstQR = true;
      debounceTime = 150;
    }
  }, debounceTime);
});

async function saveUrlIfNeeded() {
  if (!isUrlSaved && currentQrData && currentQrData.shortenedUrl) {
    const input = document.getElementById("qr-input").value.trim();

    let cfToken;
    try {
      cfToken = await getTurnstileToken();
    } catch {
      showToast("⚠️ Please complete the CAPTCHA to save");
      return;
    }

    const saveResponse = await fetch("/api/saveURL", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originalUrl: input,
        shortenedUrl: currentQrData.shortenedUrl,
        cfToken,
      }),
    });

    const result = await saveResponse.json();

    if (saveResponse.ok) {
      isUrlSaved = true;
      turnstileConsumed = true;
      if (result.shortenedUrl && result.shortenedUrl !== currentQrData.shortenedUrl) {
        currentQrData.shortenedUrl = result.shortenedUrl;
        currentQrData.fullUrl = result.fullUrl;
        document.getElementById("short-url").textContent = result.fullUrl;
      }
      showToast("✅ Link saved successfully!");
    } else if (saveResponse.status === 429) {
      showToast("⚠️ Too many requests. Please wait a moment.");
    } else {
      showToast("⚠️ Failed to save: " + (result.error || "Unknown error"));
    }
  }
}

async function copyToClipboard() {
  const copyButton = document.querySelector(".copy-btn");
  const shortUrlText = document.getElementById("short-url").textContent;
  if (!shortUrlText.trim()) return;

  await saveUrlIfNeeded();
  navigator.clipboard.writeText(shortUrlText).then(() => {
    showToast("✅ Link copied to clipboard!");
    copyButton.classList.add("copied");
    setTimeout(() => copyButton.classList.remove("copied"), 1000);
  });
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add("show"), 100);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

async function downloadQRCode() {
  if (!currentQrData) return;
  await saveUrlIfNeeded();

  const format = document.getElementById("format").value;
  const shortUrl = currentQrData.shortenedUrl.replace(/\W+/g, "");
  const fileName = `qrcode_${shortUrl}.${format}`;
  const downloadLink = document.createElement("a");

  if (format === "svg") {
    const base64Part = currentQrData.qrSvg.split(",")[1];
    const svgData = decodeURIComponent(base64Part);
    const blob = new Blob([svgData], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    downloadLink.href = url;
    downloadLink.download = fileName;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    URL.revokeObjectURL(url);
  } else if (currentQrData.qrPng) {
    downloadLink.href = currentQrData.qrPng;
    downloadLink.download = fileName;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
  }
}
