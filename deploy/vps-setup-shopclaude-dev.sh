#!/bin/bash
# Run this script ON the VPS as root after files are uploaded: bash vps-setup-shopclaude-dev.sh
# Requires SHOPCLAUDE_DEV_DB_PASSWORD to be set in the environment — used only
# to create the Postgres role; it is not written to disk by this script.
set -e

if [ -z "$SHOPCLAUDE_DEV_DB_PASSWORD" ]; then
    echo "ERROR: SHOPCLAUDE_DEV_DB_PASSWORD is not set." >&2
    exit 1
fi

echo "=== ShopClaude DEV VPS Setup ==="

# --- 1. Java 21 (shared; install only if missing) ---
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

# --- 2. Database and role (own DB, isolated from prod and gosuas) ---
echo "[2/6] Setting up database..."
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='shopclaude_dev_user'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE USER shopclaude_dev_user WITH PASSWORD '$SHOPCLAUDE_DEV_DB_PASSWORD';"

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='shopclaude_dev_db'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE DATABASE shopclaude_dev_db OWNER shopclaude_dev_user;"

sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE shopclaude_dev_db TO shopclaude_dev_user;"
echo "Database ready."

# --- 3. Directory structure ---
echo "[3/6] Creating directories..."
mkdir -p /var/www/theshopclaude-dev/app
mkdir -p /var/www/theshopclaude-dev/frontend
mkdir -p /var/www/theshopclaude-dev/uploads
chown -R www-data:www-data /var/www/theshopclaude-dev
chmod -R 755 /var/www/theshopclaude-dev

# --- 4. Secrets file (created once; left untouched on later runs) ---
echo "[4/6] Ensuring secrets file exists..."
mkdir -p /etc/shopclaude-dev
chmod 700 /etc/shopclaude-dev
if [ ! -f /etc/shopclaude-dev/shopclaude-dev.env ]; then
    echo "WARNING: /etc/shopclaude-dev/shopclaude-dev.env does not exist yet." >&2
    echo "Create it with DB_PASSWORD, JWT_SECRET, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET," >&2
    echo "ADMIN_PASSWORD, SUPERADMIN_PASSWORD, MAIL_PASSWORD before starting the service." >&2
    touch /etc/shopclaude-dev/shopclaude-dev.env
    chmod 600 /etc/shopclaude-dev/shopclaude-dev.env
fi

# --- 5. Systemd service ---
echo "[5/6] Registering systemd service..."
cp /tmp/shopclaude-dev.service /etc/systemd/system/shopclaude-dev.service
systemctl daemon-reload
systemctl enable shopclaude-dev

# --- 6. Nginx site ---
echo "[6/6] Configuring Nginx..."
cp /tmp/theshopclaude-dev.nginx.conf /etc/nginx/sites-available/theshopclaude-dev
ln -sf /etc/nginx/sites-available/theshopclaude-dev /etc/nginx/sites-enabled/theshopclaude-dev
nginx -t && echo "Nginx config OK"

echo ""
echo "=== Setup complete! ==="
echo "Fill in /etc/shopclaude-dev/shopclaude-dev.env if you haven't already, then run: bash vps-deploy-shopclaude-dev.sh"
