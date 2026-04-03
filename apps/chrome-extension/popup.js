document.addEventListener('DOMContentLoaded', async () => {
  const serverInput = document.getElementById('serverUrl');
  const syncBtn = document.getElementById('syncBtn');
  const statusMsg = document.getElementById('statusMsg');

  // Load saved URL from storage
  const result = await chrome.storage.local.get(['serverUrl']);
  if (result.serverUrl) {
    serverInput.value = result.serverUrl;
  }

  syncBtn.addEventListener('click', async () => {
    const urlStr = serverInput.value.trim();
    if (!urlStr) return;

    // Save URL for next time
    chrome.storage.local.set({ serverUrl: urlStr });

    // Format URL (remove trailing slash)
    const baseUrl = urlStr.replace(/\/$/, "");

    // UI loading state
    syncBtn.classList.add('loading');
    syncBtn.disabled = true;
    statusMsg.className = 'status';
    statusMsg.textContent = '';

    try {
      // 1. Grab all cookies for Google domains
      const cookies = await chrome.cookies.getAll({ domain: "google.com" });
      
      if (cookies.length === 0) {
        throw new Error("No Google cookies found. Please log in to Google first.");
      }

      // 2. Prepare payload exactly as the server expects
      const payload = {
        cookies: cookies.map(c => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          expires: c.expirationDate,
          httpOnly: c.httpOnly,
          secure: c.secure,
          sameSite: c.sameSite === "no_restriction" ? "None" : 
                    c.sameSite === "lax" ? "Lax" : 
                    c.sameSite === "strict" ? "Strict" : "Lax"
        })),
        source: "chrome-extension"
      };

      // 3. Send to Agent John Wick server
      const endpoint = `${baseUrl}/api/browser/import-cookies`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || data.message || "Failed to sync to server");
      }

      // Success
      statusMsg.textContent = `Success! Synced ${data.imported} cookies.`;
      statusMsg.className = 'status success';
      
    } catch (err) {
      console.error(err);
      statusMsg.textContent = err.message || "An error occurred";
      statusMsg.className = 'status error';
    } finally {
      syncBtn.classList.remove('loading');
      syncBtn.disabled = false;
    }
  });
});
