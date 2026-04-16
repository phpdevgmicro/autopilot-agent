document.addEventListener('DOMContentLoaded', async () => {
  const serverInput = document.getElementById('serverUrl');
  const emailInput = document.getElementById('profileEmail');
  const syncBtn = document.getElementById('syncBtn');
  const statusMsg = document.getElementById('statusMsg');

  // Load saved settings from storage
  const saved = await chrome.storage.local.get(['serverUrl', 'lastEmail']);
  if (saved.serverUrl) {
    serverInput.value = saved.serverUrl;
  }

  // ── Auto-detect email using multiple strategies ──
  let detectedEmail = '';

  // Strategy 1: chrome.identity API
  try {
    const userInfo = await new Promise((resolve) => {
      if (chrome.identity && chrome.identity.getProfileUserInfo) {
        chrome.identity.getProfileUserInfo({ accountStatus: "ANY" }, resolve);
      } else {
        resolve({});
      }
    });
    if (userInfo.email) {
      detectedEmail = userInfo.email;
    }
  } catch (e) {
    console.log('[ext] identity detection failed:', e);
  }

  // Strategy 2: Read GMAIL_AT or SAPISID cookies to confirm login, use saved email
  if (!detectedEmail) {
    try {
      const cookies = await chrome.cookies.getAll({ domain: ".google.com" });
      // Look for cookies that indicate active Google session
      const sessionCookies = cookies.filter(c =>
        ['SAPISID', '__Secure-3PAPISID', 'SID', 'HSID', 'SSID', 'APISID'].includes(c.name)
      );
      if (sessionCookies.length > 0 && saved.lastEmail) {
        detectedEmail = saved.lastEmail;
      }
    } catch (e) {
      console.log('[ext] cookie heuristic failed:', e);
    }
  }

  // Strategy 3: Try to extract email from Google accounts cookies page title
  if (!detectedEmail) {
    try {
      // Try to get email from active tabs showing Google pages
      const tabs = await chrome.tabs.query({ url: "https://*.google.com/*", active: true });
      if (tabs.length > 0) {
        // The page title might contain the email
        const tab = tabs[0];
        if (tab.title && tab.title.includes('@')) {
          const match = tab.title.match(/[\w.-]+@[\w.-]+/);
          if (match) {
            detectedEmail = match[0];
          }
        }
      }
    } catch (e) {
      console.log('[ext] tab title detection failed:', e);
    }
  }

  // Set the email input value
  if (detectedEmail) {
    emailInput.value = detectedEmail;
  } else if (saved.lastEmail) {
    emailInput.value = saved.lastEmail;
  }

  // ── Sync button handler ──
  syncBtn.addEventListener('click', async () => {
    const urlStr = serverInput.value.trim();
    const email = emailInput.value.trim();
    
    if (!urlStr) {
      statusMsg.textContent = 'Please enter the Agent Server URL';
      statusMsg.className = 'status error';
      return;
    }
    
    if (!email) {
      statusMsg.textContent = 'Please enter your Google email address';
      statusMsg.className = 'status error';
      emailInput.focus();
      return;
    }

    // Save settings
    chrome.storage.local.set({ serverUrl: urlStr, lastEmail: email });

    const baseUrl = urlStr.replace(/\/$/, "");

    // UI loading state
    syncBtn.classList.add('loading');
    syncBtn.disabled = true;
    statusMsg.className = 'status';
    statusMsg.textContent = '';

    try {
      // 1. Grab all cookies for Google domains + YouTube + ALL key Google services
      const googleDomains = [
        ".google.com",
        "google.com",
        "www.google.com",
        "accounts.google.com",
        "myaccount.google.com",
        "drive.google.com",
        "mail.google.com",
        "docs.google.com",
        "sheets.google.com",
        "slides.google.com",
        "calendar.google.com",
        "contacts.google.com",
        "play.google.com",
        "photos.google.com",
        "meet.google.com",
        "chat.google.com",
        "keep.google.com",
        "translate.google.com",
        "maps.google.com",
        ".youtube.com",
        "youtube.com",
        "console.cloud.google.com",
        "cloud.google.com",
      ];
      
      const allResults = await Promise.all(
        googleDomains.map(d => chrome.cookies.getAll({ domain: d }))
      );
      
      // Deduplicate by name+domain+path
      const seen = new Set();
      const cookies = [];
      for (const batch of allResults) {
        for (const c of batch) {
          const key = `${c.name}|${c.domain}|${c.path}`;
          if (!seen.has(key)) {
            seen.add(key);
            cookies.push(c);
          }
        }
      }
      
      if (cookies.length === 0) {
        throw new Error("No Google cookies found. Please log in to Google first.");
      }

      // Diagnostic: log critical auth cookies for debugging
      const criticalNames = ['SID', 'HSID', 'SSID', 'APISID', 'SAPISID', '__Secure-1PSID', '__Secure-3PSID'];
      const foundCritical = cookies.filter(c => criticalNames.includes(c.name) && c.domain.includes('google'));
      const missingCritical = criticalNames.filter(n => !foundCritical.some(c => c.name === n));
      console.log(`[ext] Captured ${cookies.length} cookies. Auth cookies: ${foundCritical.map(c => c.name).join(', ') || 'NONE'}`);
      if (missingCritical.length > 0) {
        console.warn(`[ext] ⚠️ Missing auth cookies: ${missingCritical.join(', ')}`);
      }

      // 2. Prepare payload — profileName = email
      const payload = {
        profileName: email,
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
      statusMsg.textContent = `Success! Synced ${cookies.length} cookies as "${email}".`;
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
