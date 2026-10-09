#!/bin/bash
# Run this script ON the VPS as root:  bash vps-setup.sh
set -e

DB_PASSWORD="Gosuas@2024Secure"

echo "=== GOSUAS VPS Setup ==="

# --- 1. Install Java 21 if not present ---
if ! java -version 2>&1 | grep -q "21"; then
    echo "[1/8] Installing Java 21..."
    apt-get update -q
    apt-get install -y wget gnupg
    wget -qO /tmp/jdk21.deb https://packages.microsoft.com/repos/microsoft-ubuntu-jammy-prod/pool/main/m/msopenjdk-21/msopenjdk-21_21.0.11_amd64.deb 2>/dev/null || true
    # Fallback: use temurin from adoptium
    wget -qO - https://packages.adoptium.net/artifactory/api/gpg/key/public | gpg --dearmor | tee /etc/apt/trusted.gpg.d/adoptium.gpg > /dev/null
    echo "deb https://packages.adoptium.net/artifactory/deb $(awk -F= '/^VERSION_CODENAME/{print$2}' /etc/os-release) main" | tee /etc/apt/sources.list.d/adoptium.list
    apt-get update -q
    apt-get install -y temurin-21-jdk
    echo "Java 21 installed."
else
    echo "[1/8] Java 21 already available."
fi

# Confirm java binary path
JAVA_BIN=$(which java)
echo "Using Java: $JAVA_BIN"

# --- 2. Install PostgreSQL if not present ---
if ! command -v psql &>/dev/null; then
    echo "[2/8] Installing PostgreSQL..."
    apt-get install -y postgresql postgresql-contrib
    systemctl enable postgresql
    systemctl start postgresql
    echo "PostgreSQL installed."
else
    echo "[2/8] PostgreSQL already installed."
fi

# --- 3. Create DB and user ---
echo "[3/8] Setting up database..."
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='gosuas_user'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE USER gosuas_user WITH PASSWORD '$DB_PASSWORD';"

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='gosuas_core_db'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE DATABASE gosuas_core_db OWNER gosuas_user;"

sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE gosuas_core_db TO gosuas_user;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE gosuas_core_db TO yourusername;"
echo "Database ready."

# --- 4. Install Nginx if not present ---
if ! command -v nginx &>/dev/null; then
    echo "[4/8] Installing Nginx..."
    apt-get install -y nginx
    systemctl enable nginx
    echo "Nginx installed."
else
    echo "[4/8] Nginx already installed."
fi

# --- 5. Create directory structure ---
echo "[5/8] Creating directories..."
mkdir -p /var/www/gosuas/app
mkdir -p /var/www/gosuas/frontend
mkdir -p /var/www/gosuas/uploads
chown -R www-data:www-data /var/www/gosuas
chmod -R 755 /var/www/gosuas

# --- 6. Install Certbot if not present ---
if ! command -v certbot &>/dev/null; then
    echo "[6/8] Installing Certbot..."
    apt-get install -y certbot python3-certbot-nginx
else
    echo "[6/8] Certbot already installed."
fi

# --- 7. Enable systemd service ---
echo "[7/8] Setting up systemd service..."
cp /tmp/gosuas.service /etc/systemd/system/gosuas.service
systemctl daemon-reload
systemctl enable gosuas
echo "Systemd service registered."

# --- 8. Configure Nginx ---
echo "[8/8] Configuring Nginx..."
cp /tmp/sales.gosuas.com.nginx.conf /etc/nginx/sites-available/sales.gosuas.com
ln -sf /etc/nginx/sites-available/sales.gosuas.com /etc/nginx/sites-enabled/sales.gosuas.com
nginx -t && echo "Nginx config OK"

echo ""
echo "=== Setup complete! ==="
echo "Now run: bash vps-deploy.sh  (on the VPS)"
