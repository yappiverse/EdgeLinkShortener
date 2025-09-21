let currentQrData = null;
let isUrlSaved = false;
let debounceTime = 0;
let hasGeneratedFirstQR = false;

function debounce(func, delay) {
  clearTimeout(debounce.timer);
  debounce.timer = setTimeout(func, delay);
}

function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

async function generateShortUrl(input) {
  const format = document.getElementById("format").value;
  const cfToken = window.getTurnstileToken?.();
  // console.log("Turnstile token:", cfToken);

  if (!cfToken) {
    document.getElementById("captcha-error").style.display = "block";
    return { error: "Captcha required" };
  }

  const res = await fetch("/api/generateShortenedUrl", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: input, format }),
  });
  // console.log("res", res);
  const data = await res.json();
  // console.log("data", data);
  // if (window.turnstile) {
  //   const cfWidget = document.querySelector(".cf-challenge");
  //   window.turnstile.reset(cfWidget);
  // }

  return data;
}

async function updateQRCode() {
  const input = document.getElementById("qr-input").value;
  const format = document.getElementById("format").value;
  const img = document.getElementById("qr-code");
  const downloadBtn = document.getElementById("download-btn");
  const urlInfo = document.getElementById("url-info");
  const originalUrlSpan = document.getElementById("original-url");
  const shortUrlSpan = document.getElementById("short-url");
  const errorMessage = document.getElementById("error-message");

  errorMessage.style.display = "none";

  if (!input.trim()) {
    img.style.display = "none";
    img.classList.remove("fade-in");
    downloadBtn.classList.add("hidden");
    urlInfo.classList.add("hidden");
    return;
  }

  if (!isValidUrl(input)) {
    errorMessage.style.display = "block";
    img.style.display = "none";
    img.classList.remove("fade-in");
    downloadBtn.classList.add("hidden");
    urlInfo.classList.add("hidden");
    return;
  }

  currentQrData = await generateShortUrl(input);
  isUrlSaved = false;

  if (currentQrData.qrPng && currentQrData.qrSvg) {
    img.dataset.png = currentQrData.qrPng;
    img.dataset.svg = currentQrData.qrSvg;
    img.src = format === "svg" ? currentQrData.qrSvg : currentQrData.qrPng;
    img.style.display = "block";
    img.classList.add("fade-in");
    downloadBtn.classList.remove("hidden");

    originalUrlSpan.textContent = input;
    shortUrlSpan.textContent = currentQrData.fullUrl;
    urlInfo.classList.remove("hidden");

    await saveUrlIfNeeded();
  } else {
    console.error("QR Code data missing from API response");
    errorMessage.style.display = "block";
  }
}

document.getElementById("format").addEventListener("change", () => {
  const img = document.getElementById("qr-code");
  const format = document.getElementById("format").value;
  img.src = format === "svg" ? img.dataset.svg : img.dataset.png;
});

document.getElementById("qr-input").addEventListener("input", () => {
  currentQrData = null;
  isUrlSaved = false;
  debounce(() => {
    updateQRCode();
    if (!hasGeneratedFirstQR) {
      hasGeneratedFirstQR = true;
      debounceTime = 150;
    }
  }, debounceTime);
});

async function saveUrlIfNeeded() {
  if (!isUrlSaved && currentQrData) {
    const input = document.getElementById("qr-input").value;
    const saveResponse = await fetch("/api/saveURL", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        originalUrl: input,
        shortenedUrl: currentQrData.shortenedUrl,
      }),
    });

    if (saveResponse.ok) {
      isUrlSaved = true;
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
    const svgData = atob(currentQrData.qrSvg.split(",")[1]);
    const blob = new Blob([svgData], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    downloadLink.href = url;
    downloadLink.download = fileName;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    URL.revokeObjectURL(url);
  } else {
    downloadLink.href = currentQrData.qrPng;
    downloadLink.download = fileName;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
  }
}
