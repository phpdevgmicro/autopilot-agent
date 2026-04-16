#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# Enterprise Browser Agent — Google Compute Engine Setup Script
# ═══════════════════════════════════════════════════════════════════════
#
# One-command setup for a new GCE VM (Ubuntu 22.04+)
# Run: bash infrastructure/setup-gce.sh
#
# What this does:
#   1. Installs Google Chrome, Node.js 22, pnpm, PM2
#   2. Clones the repo and installs dependencies
#   3. Configures firewall (SSH + HTTPS only)
#   4. Sets up Caddy reverse proxy with auto-SSL
#   5. Creates systemd service for PM2
#   6. Starts everything
#
# Prerequisites:
#   - Ubuntu 22.04 LTS GCE VM (e2-standard-2 recommended: 2 vCPU, 8GB RAM)
#   - SSH access
#   - Domain pointed to VM's external IP (for auto-SSL)
# ═══════════════════════════════════════════════════════════════════════

set -euo pipefail

echo "═══════════════════════════════════════════════════"
echo "  🤖 Enterprise Browser Agent — GCE Setup"
echo "═══════════════════════════════════════════════════"

# ── Variables ────────────────────────────────────────────────────────
REPO_URL="${REPO_URL:-https://github.com/your-org/openai-cua-sample-app.git}"
APP_DIR="/opt/autopilot-agent"
AGENT_USER="agent"
NODE_VERSION="22"
DOMAIN="${DOMAIN:-}" # Set via: DOMAIN=agent.yourdomain.com bash setup-gce.sh

# ── 1. System Updates ────────────────────────────────────────────────
echo ""
echo "📦 Step 1/7: System updates..."
sudo apt-get update -y
sudo apt-get upgrade -y
sudo apt-get install -y curl wget gnupg2 software-properties-common git

# ── 2. Install Google Chrome ─────────────────────────────────────────
echo ""
echo "🌐 Step 2/7: Installing Google Chrome..."
if ! command -v google-chrome-stable &> /dev/null; then
  wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
  echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list
  sudo apt-get update -y
  sudo apt-get install -y google-chrome-stable
fi
echo "  ✅ Chrome: $(google-chrome-stable --version)"

# Install necessary Chrome dependencies for headless
sudo apt-get install -y \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 \
  libgbm1 libpango-1.0-0 libcairo2 libasound2 libxshmfence1 \
  fonts-liberation xdg-utils

# ── 3. Install Node.js via nvm ───────────────────────────────────────
echo ""
echo "📗 Step 3/7: Installing Node.js ${NODE_VERSION}..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "  ✅ Node: $(node --version)"

# Install pnpm
if ! command -v pnpm &> /dev/null; then
  npm install -g pnpm
fi
echo "  ✅ pnpm: $(pnpm --version)"

# Install PM2
if ! command -v pm2 &> /dev/null; then
  npm install -g pm2
fi
echo "  ✅ PM2: $(pm2 --version)"

# ── 4. Create agent user ─────────────────────────────────────────────
echo ""
echo "👤 Step 4/7: Creating agent user..."
if ! id "$AGENT_USER" &> /dev/null; then
  sudo useradd -m -s /bin/bash -G sudo "$AGENT_USER"
  echo "  ✅ Created user: $AGENT_USER"
else
  echo "  ℹ️ User $AGENT_USER already exists"
fi

# ── 5. Clone and setup repo ──────────────────────────────────────────
echo ""
echo "📂 Step 5/7: Setting up application..."
sudo mkdir -p "$APP_DIR"
sudo chown "$AGENT_USER:$AGENT_USER" "$APP_DIR"

if [ ! -d "$APP_DIR/.git" ]; then
  sudo -u "$AGENT_USER" git clone "$REPO_URL" "$APP_DIR"
else
  echo "  ℹ️ Repo already cloned, pulling latest..."
  cd "$APP_DIR"
  sudo -u "$AGENT_USER" git pull
fi

cd "$APP_DIR"
sudo -u "$AGENT_USER" pnpm install

# Create required directories
sudo -u "$AGENT_USER" mkdir -p /home/$AGENT_USER/.autopilot-agent/browser-profiles/default
sudo -u "$AGENT_USER" mkdir -p /home/$AGENT_USER/.autopilot-agent/logs
sudo -u "$AGENT_USER" mkdir -p /home/$AGENT_USER/.autopilot-agent/status

# Create .env.production if it doesn't exist
if [ ! -f "$APP_DIR/.env.production" ]; then
  cat > "$APP_DIR/.env.production" << 'EOF'
# ═══════════════════════════════════════════════════════════════════
# Enterprise Browser Agent — Production Environment
# ═══════════════════════════════════════════════════════════════════

# OpenAI API Key (REQUIRED)
OPENAI_API_KEY=sk-your-key-here

# Browser configuration
CUA_BROWSER_MODE=cdp
CUA_BROWSER_CHANNEL=chrome
CUA_BROWSER_PERSIST=true
CUA_BROWSER_PROFILE_DIR=/home/agent/.autopilot-agent/browser-profiles
CUA_VIEWPORT_WIDTH=1920
CUA_VIEWPORT_HEIGHT=1080

# Chrome CDP
CDP_PORT=9222

# MCP Bridge (enable for A11y tree perception)
CUA_MCP_ENABLED=true

# Agent model
CUA_MODEL=gpt-5-mini
CUA_REASONING_EFFORT=medium

# Performance
CUA_INTER_ACTION_DELAY_MS=120
CUA_INITIAL_TURN_BUDGET=15
CUA_TOOL_TIMEOUT_MS=20000

# Webhook (optional — n8n task logger)
# CUA_WEBHOOK_URL=https://your-n8n.example.com/webhook/...

# Node environment
NODE_ENV=production
EOF
  sudo chown "$AGENT_USER:$AGENT_USER" "$APP_DIR/.env.production"
  echo "  ⚠️ Created .env.production — EDIT IT with your OPENAI_API_KEY!"
fi

# ── 6. Install Caddy (reverse proxy + auto-HTTPS) ────────────────────
echo ""
echo "🔒 Step 6/7: Installing Caddy reverse proxy..."
if ! command -v caddy &> /dev/null; then
  sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
  sudo apt-get update -y
  sudo apt-get install -y caddy
fi
echo "  ✅ Caddy: $(caddy version)"

# Configure Caddy
if [ -n "$DOMAIN" ]; then
  sudo cp "$APP_DIR/infrastructure/Caddyfile" /etc/caddy/Caddyfile
  sudo sed -i "s/YOUR_DOMAIN/${DOMAIN}/g" /etc/caddy/Caddyfile
  sudo systemctl enable caddy
  sudo systemctl restart caddy
  echo "  ✅ Caddy configured for: $DOMAIN"
else
  echo "  ⚠️ No DOMAIN set — run with DOMAIN=agent.yourdomain.com to enable HTTPS"
fi

# ── 7. Configure Firewall ────────────────────────────────────────────
echo ""
echo "🔥 Step 7/7: Configuring firewall..."
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp   # HTTP (Caddy redirect)
sudo ufw allow 443/tcp  # HTTPS (Caddy)
# IMPORTANT: Do NOT expose CDP port (9222) — it's internal only
sudo ufw --force enable
echo "  ✅ Firewall: SSH + HTTP/HTTPS only (CDP port 9222 is internal)"

# ── Start Everything ─────────────────────────────────────────────────
echo ""
echo "🚀 Starting services..."
cd "$APP_DIR"

# Load env vars
set -a
source .env.production
set +a

# Start PM2
sudo -u "$AGENT_USER" pm2 start infrastructure/pm2.config.cjs
sudo -u "$AGENT_USER" pm2 save

# Setup PM2 to start on boot
sudo -u "$AGENT_USER" pm2 startup systemd -u "$AGENT_USER" --hp "/home/$AGENT_USER" 2>/dev/null || true

echo ""
echo "═══════════════════════════════════════════════════"
echo "  ✅ Setup Complete!"
echo "═══════════════════════════════════════════════════"
echo ""
echo "  📋 Next steps:"
echo "    1. Edit .env.production with your OPENAI_API_KEY"
echo "    2. Point your domain DNS to this VM's IP"
echo "    3. Run: DOMAIN=agent.yourdomain.com bash infrastructure/setup-gce.sh"
echo ""
echo "  🔑 Commands:"
echo "    pm2 status          — Check process status"
echo "    pm2 logs             — View all logs"
echo "    pm2 logs runner      — View runner logs"
echo "    pm2 restart all      — Restart everything"
echo "    pm2 monit            — Real-time monitoring"
echo ""
if [ -n "$DOMAIN" ]; then
  echo "  🌐 Access: https://${DOMAIN}"
else
  echo "  🌐 Access: http://$(curl -s ifconfig.me):3100 (no HTTPS yet)"
fi
echo ""
