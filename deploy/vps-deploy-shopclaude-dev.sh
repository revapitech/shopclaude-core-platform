#!/bin/bash
# Run this script ON the VPS as root after files are uploaded: bash vps-deploy-shopclaude-dev.sh
set -e

echo "=== Deploying ShopClaude DEV Application ==="

# Copy JAR
echo "[1/4] Deploying backend JAR..."
cp /tmp/shopclaude-dev.jar /var/www/theshopclaude-dev/app/shopclaude-dev.jar
chown www-data:www-data /var/www/theshopclaude-dev/app/shopclaude-dev.jar

# Copy frontend dist
echo "[2/4] Deploying frontend..."
rm -rf /var/www/theshopclaude-dev/frontend/*
cp -r /tmp/shopclaude-dev-frontend/* /var/www/theshopclaude-dev/frontend/
chown -R www-data:www-data /var/www/theshopclaude-dev/frontend

# Install updated service file and restart backend
echo "[3/4] Restarting backend service..."
cp /tmp/shopclaude-dev.service /etc/systemd/system/shopclaude-dev.service
systemctl daemon-reload
systemctl restart shopclaude-dev
sleep 5
if systemctl is-active --quiet shopclaude-dev; then
    echo "Backend is running."
else
    echo "ERROR: Backend failed to start. Check logs: journalctl -u shopclaude-dev -n 50"
    exit 1
fi

# Reload Nginx
echo "[4/4] Reloading Nginx..."
nginx -t && systemctl reload nginx

echo ""
echo "=== Deployment complete! ==="
echo "Sites: https://dev.theshopclaude.com and https://*.dev.theshopclaude.com"
echo "Backend health: curl http://localhost:8085/gosuas-core/api/public/products"
