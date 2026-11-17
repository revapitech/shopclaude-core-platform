#!/bin/bash
# Run this script ON the VPS as root after files are uploaded: bash vps-setup-shopclaude.sh
# Requires SHOPCLAUDE_DB_PASSWORD to be set in the environment — used only to
# create the Postgres role; it is not written to disk by this script.
set -e

if [ -z "$SHOPCLAUDE_DB_PASSWORD" ]; then
    echo "ERROR: SHOPCLAUDE_DB_PASSWORD is not set." >&2
    exit 1
fi

echo "=== ShopClaude VPS Setup ==="

# --- 1. Java 21 (shared with gosuas; install only if missing) ---
if ! command -v java &>/dev/null; then
    echo "[1/6] Installing Java 21..."
    apt-get update -q
    apt-get install -y wget gnupg
    wget -qO - https://packages.adoptium.net/artifactory/api/gpg/key/public | gpg --dearmor | tee /etc/apt/trusted.gpg.d/adoptium.gpg > /dev/null
    echo "deb https://packages.adoptium.net/artifactory/deb $(awk -F= '/^VERSION_CODENAME/{print$2}' /etc/os-release) main" | tee /etc/apt/sources.list.d/adoptium.list
    apt-get update -q
    apt-get install -y temurin-21-jdk
else
    echo "[1/6] Java already available: $(which java)"
fi

# --- 2. Database and role (own DB, isolated from gosuas) ---
echo "[2/6] Setting up database..."
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='shopclaude_user'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE USER shopclaude_user WITH PASSWORD '$SHOPCLAUDE_DB_PASSWORD';"

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='shopclaude_db'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE DATABASE shopclaude_db OWNER shopclaude_user;"

sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE shopclaude_db TO shopclaude_user;"
echo "Database ready."

# --- 3. Directory structure ---
echo "[3/6] Creating directories..."
mkdir -p /var/www/theshopclaude/app
mkdir -p /var/www/theshopclaude/frontend
mkdir -p /var/www/theshopclaude/uploads
chown -R www-data:www-data /var/www/theshopclaude
chmod -R 755 /var/www/theshopclaude

# --- 4. Secrets file (created once; left untouched on later runs) ---
echo "[4/6] Ensuring secrets file exists..."
mkdir -p /etc/shopclaude
chmod 700 /etc/shopclaude
if [ ! -f /etc/shopclaude/shopclaude.env ]; then
    echo "WARNING: /etc/shopclaude/shopclaude.env does not exist yet." >&2
    echo "Create it with DB_PASSWORD, JWT_SECRET, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET," >&2
    echo "ADMIN_PASSWORD, SUPERADMIN_PASSWORD, MAIL_PASSWORD before starting the service." >&2
    touch /etc/shopclaude/shopclaude.env
    chmod 600 /etc/shopclaude/shopclaude.env
fi

# --- 5. Systemd service ---
echo "[5/6] Registering systemd service..."
cp /tmp/shopclaude.service /etc/systemd/system/shopclaude.service
systemctl daemon-reload
systemctl enable shopclaude

# --- 6. Nginx site ---
echo "[6/6] Configuring Nginx..."
cp /tmp/theshopclaude.nginx.conf /etc/nginx/sites-available/theshopclaude
ln -sf /etc/nginx/sites-available/theshopclaude /etc/nginx/sites-enabled/theshopclaude
nginx -t && echo "Nginx config OK"

echo ""
echo "=== Setup complete! ==="
echo "Fill in /etc/shopclaude/shopclaude.env if you haven't already, then run: bash vps-deploy-shopclaude.sh"