let currentQrData = null;
let debounceTime = 300;
let hasGeneratedFirstQR = false;
let turnstileToken = null;
let qrcodeInstance = null;

async function initTurnstile() {
  if (typeof turnstile === "undefined") {
    setTimeout(initTurnstile, 100);
    return;
  }
  try {
    const res = await fetch("/api/config");
    const { sitekey } = await res.json();
    if (!sitekey) return;

    const container = document.getElementById("cf-turnstile");
    if (!container) return;
    container.innerHTML = "";
    turnstile.render("#cf-turnstile", {
      sitekey,
      appearance: "always",
      callback: (token) => {
        turnstileToken = token;
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
  if (turnstileToken) return turnstileToken;
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const interval = setInterval(() => {
      if (turnstileToken) {
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
    body: JSON.stringify({ url: input, cfToken }),
  });

  const data = await res.json();
  turnstileToken = null;
  if (typeof turnstile !== "undefined") {
    turnstile.reset("#cf-turnstile");
  }
  return data;
}

function renderClientQRCode(text) {
  const container = document.getElementById("qrcode-container");
  if (!container) return;
  container.innerHTML = "";
  if (typeof QRCode === "undefined" && typeof window.QRCode !== "undefined") {
    window.QRCode = window.QRCode;
  }
  const QR = typeof QRCode !== "undefined" ? QRCode : window.QRCode;
  if (!QR) {
    console.error("QRCode library not loaded yet");
    return;
  }
  qrcodeInstance = new QR(container, {
    text: text,
    width: 256,
    height: 256,
    colorDark: "#000000",
    colorLight: "#ffffff",
    correctLevel: QR.CorrectLevel ? QR.CorrectLevel.M : 0,
  });
  container.style.display = "flex";
}

function generateSvgFromModel(qrModel) {
  if (!qrModel) return null;
  const count = qrModel.getModuleCount();
  const size = 256;
  let rects = "";
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qrModel.isDark(row, col)) {
        rects += `<rect x="${col}" y="${row}" width="1" height="1" fill="#000000"/>`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${count} ${count}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#ffffff"/>${rects}</svg>`;
}

async function updateQRCode() {
  const input = document.getElementById("qr-input").value.trim();
  const downloadBtn = document.getElementById("download-btn");
  const urlInfo = document.getElementById("url-info");
  const originalUrlSpan = document.getElementById("original-url");
  const shortUrlSpan = document.getElementById("short-url");
  const errorMessage = document.getElementById("error-message");
  const qrContainer = document.getElementById("qrcode-container");

  errorMessage.style.display = "none";

  if (!input) {
    qrContainer.style.display = "none";
    qrContainer.innerHTML = "";
    downloadBtn.classList.add("hidden");
    urlInfo.classList.add("hidden");
    return;
  }

  if (!isValidHttpUrl(input)) {
    errorMessage.style.display = "block";
    qrContainer.style.display = "none";
    qrContainer.innerHTML = "";
    downloadBtn.classList.add("hidden");
    urlInfo.classList.add("hidden");
    return;
  }

  currentQrData = await generateShortUrl(input);

  if (currentQrData && currentQrData.fullUrl) {
    renderClientQRCode(currentQrData.fullUrl);
    downloadBtn.classList.remove("hidden");

    originalUrlSpan.textContent = input;
    shortUrlSpan.textContent = currentQrData.fullUrl;
    urlInfo.classList.remove("hidden");
  } else {
    errorMessage.style.display = "block";
  }
}

document.getElementById("qr-input").addEventListener("input", () => {
  currentQrData = null;
  turnstileToken = null;
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

async function copyToClipboard() {
  const copyButton = document.querySelector(".copy-btn");
  const shortUrlText = document.getElementById("short-url").textContent;
  if (!shortUrlText.trim()) return;

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

function downloadQRCode() {
  if (!currentQrData || !currentQrData.shortenedUrl) return;

  const format = document.getElementById("format").value;
  const shortUrl = currentQrData.shortenedUrl.replace(/\W+/g, "");
  const fileName = `qrcode_${shortUrl}.${format}`;
  const qrContainer = document.getElementById("qrcode-container");

  if (format === "svg") {
    const qrModel = qrcodeInstance && qrcodeInstance._oQRCode ? qrcodeInstance._oQRCode : null;
    const svgString = generateSvgFromModel(qrModel);
    if (!svgString) return;

    const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const downloadLink = document.createElement("a");
    downloadLink.href = url;
    downloadLink.download = fileName;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    URL.revokeObjectURL(url);
    return;
  }

  const canvas = qrContainer.querySelector("canvas");
  const img = qrContainer.querySelector("img");

  let dataUrl = "";
  if (canvas) {
    dataUrl = canvas.toDataURL("image/png");
  } else if (img && img.src) {
    dataUrl = img.src;
  }

  if (!dataUrl) return;

  const downloadLink = document.createElement("a");
  downloadLink.href = dataUrl;
  downloadLink.download = fileName;
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
}
