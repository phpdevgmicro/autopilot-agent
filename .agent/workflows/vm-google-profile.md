---
description: How to set up or change Google profile on the headless VM
---

# VM Google Profile Setup (via noVNC)

The CUA agent VM is headless (no display), so you can't open a browser window directly.
This workflow uses **noVNC** to give you a visual browser on the VM via your local browser.

## Prerequisites
- SSH access to VM: `ssh -i ~/.ssh/gcp_deploy_key github-deploy@34.182.70.213`
- Packages installed on VM: `xvfb`, `x11vnc`, `novnc`, `websockify`
  - If not installed: `sudo apt-get install -y xvfb x11vnc novnc websockify`

## Steps

### 1. Clear old profile (if changing accounts)
```bash
ssh -i "$env:USERPROFILE\.ssh\gcp_deploy_key" github-deploy@34.182.70.213 "sudo rm -rf /opt/cua-agent/browser-profile"
```

### 2. Create and run the login script on VM
```bash
ssh -i "$env:USERPROFILE\.ssh\gcp_deploy_key" github-deploy@34.182.70.213 "cat > /tmp/start-login.sh << 'SCRIPT'
#!/bin/bash
pkill -x chrome 2>/dev/null
pkill -x Xvfb 2>/dev/null
pkill -x x11vnc 2>/dev/null
pkill -x websockify 2>/dev/null
rm -f /tmp/.X99-lock
sleep 1

sudo mkdir -p /opt/cua-agent/browser-profile
sudo chown phpdevgmicro:phpdevgmicro /opt/cua-agent/browser-profile

Xvfb :99 -screen 0 1280x900x24 &
sleep 1

export DISPLAY=:99
/home/phpdevgmicro/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome \
  --no-sandbox --disable-gpu --disable-dev-shm-usage \
  --disable-blink-features=AutomationControlled \
  --no-first-run --no-default-browser-check \
  --user-data-dir=/opt/cua-agent/browser-profile \
  --window-size=1280,900 \
  https://accounts.google.com &
sleep 2

x11vnc -display :99 -passwd login123 -rfbport 5900 -shared -forever -bg
sleep 1

websockify --web=/usr/share/novnc 6080 localhost:5900 &
sleep 1

echo 'READY! Open http://localhost:6080/vnc.html (password: login123)'
SCRIPT
chmod +x /tmp/start-login.sh && sudo -u phpdevgmicro bash /tmp/start-login.sh"
```

### 3. Open SSH tunnel for noVNC
// turbo
```bash
ssh -i "$env:USERPROFILE\.ssh\gcp_deploy_key" -L 6080:localhost:6080 -N github-deploy@34.182.70.213
```

### 4. Open noVNC in your local browser
- URL: `http://localhost:6080/vnc.html`
- Password: `login123`
- Log in to Google in the VM browser

### 5. After login, clean up VNC and restart app
```bash
ssh -i "$env:USERPROFILE\.ssh\gcp_deploy_key" github-deploy@34.182.70.213 "sudo pkill -x x11vnc; sudo pkill -x websockify; sudo pkill -x Xvfb; sudo pkill -u phpdevgmicro chrome; sudo rm -f /tmp/.X99-lock; sleep 2; sudo -u phpdevgmicro bash -c 'cd /home/phpdevgmicro/autopilot-agent && nohup pnpm dev > /tmp/cua-dev.log 2>&1 &'; echo 'App restarted'"
```

### 6. Verify profile is linked
```bash
ssh -i "$env:USERPROFILE\.ssh\gcp_deploy_key" github-deploy@34.182.70.213 "curl -s http://localhost:4001/api/browser/profile-status"
```
Should return: `{"persist":true,"profileDir":"/opt/cua-agent/browser-profile","profileExists":true}`

## Key Info
| Item | Value |
|------|-------|
| VM IP | `34.182.70.213` |
| SSH User | `github-deploy` |
| SSH Key | `~/.ssh/gcp_deploy_key` |
| App User | `phpdevgmicro` |
| Profile Dir | `/opt/cua-agent/browser-profile` |
| App Dir | `/home/phpdevgmicro/autopilot-agent` |
| Session Lasts | ~2 weeks before re-login needed |
