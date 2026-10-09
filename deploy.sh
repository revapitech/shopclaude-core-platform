#!/bin/bash
# Local deploy script — run this on your Mac to build and upload to VPS
# Usage: bash deploy.sh [vps-user] [vps-ip] [vps-password]
# Example: bash deploy.sh root 69.62.73.165 MyPass123

VPS_USER="${1:-root}"
VPS_IP="${2:-69.62.73.165}"
VPS_PASS="${3:-}"
JAVA21_HOME="/Users/unnimayakrishnan/Library/Java/JavaVirtualMachines/ms-21.0.11/Contents/Home"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
DEPLOY_DIR="$SCRIPT_DIR/deploy"

# Wrap ssh/scp with sshpass if a password is provided
if [ -n "$VPS_PASS" ]; then
  SSH="sshpass -p $VPS_PASS ssh -o StrictHostKeyChecking=no"
  SCP="sshpass -p $VPS_PASS scp -o StrictHostKeyChecking=no"
else
  SSH="ssh"
  SCP="scp"
fi

set -e

echo "=== GOSUAS Deploy to $VPS_USER@$VPS_IP ==="

# --- 1. Build backend ---
echo "[1/5] Building backend (Java 21)..."
cd "$BACKEND_DIR"
JAVA_HOME="$JAVA21_HOME" mvn package -DskipTests -q
echo "Backend built: $(ls target/gosuas-core-backend-*.jar)"

# --- 2. Build frontend ---
echo "[2/5] Building frontend..."
cd "$FRONTEND_DIR"
rm -rf dist
npm run build --silent
echo "Frontend built: $(ls dist/index.html)"

# --- 3. Upload files to VPS ---
echo "[3/5] Uploading to VPS..."
JAR_FILE=$(ls $BACKEND_DIR/target/gosuas-core-backend-*.jar | tail -1)

$SCP "$JAR_FILE" "$VPS_USER@$VPS_IP:/tmp/gosuas.jar"

cd "$FRONTEND_DIR"
tar czf /tmp/gosuas-frontend.tar.gz --exclude='._*' -C dist .
$SCP /tmp/gosuas-frontend.tar.gz "$VPS_USER@$VPS_IP:/tmp/gosuas-frontend.tar.gz"
rm /tmp/gosuas-frontend.tar.gz

$SCP "$DEPLOY_DIR/gosuas.service"                 "$VPS_USER@$VPS_IP:/tmp/gosuas.service"
$SCP "$DEPLOY_DIR/sales.gosuas.com.nginx.conf"    "$VPS_USER@$VPS_IP:/tmp/sales.gosuas.com.nginx.conf"
$SCP "$DEPLOY_DIR/vps-setup.sh"                   "$VPS_USER@$VPS_IP:/tmp/vps-setup.sh"
$SCP "$DEPLOY_DIR/vps-deploy.sh"                  "$VPS_USER@$VPS_IP:/tmp/vps-deploy.sh"

echo "All files uploaded."

# --- 4. Run setup on VPS (first deploy only) ---
echo "[4/5] Running VPS setup (install Java21, PostgreSQL, Nginx if needed)..."
$SSH "$VPS_USER@$VPS_IP" "rm -rf /tmp/gosuas-frontend && mkdir -p /tmp/gosuas-frontend && tar xzf /tmp/gosuas-frontend.tar.gz -C /tmp/gosuas-frontend && bash /tmp/vps-setup.sh"

# --- 5. Deploy application ---
echo "[5/5] Deploying application..."
$SSH "$VPS_USER@$VPS_IP" "bash /tmp/vps-deploy.sh"

echo ""
echo "=== All done! ==="
echo "Visit: http://sales.gosuas.com  (after DNS is set)"
echo "To enable HTTPS after DNS propagates, SSH in and run:"
echo "  certbot --nginx -d sales.gosuas.com --non-interactive --agree-tos -m mayaorez23@gmail.com"
