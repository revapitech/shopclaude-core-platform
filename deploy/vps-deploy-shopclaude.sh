#!/bin/bash
# Run this script ON the VPS as root after files are uploaded: bash vps-deploy-shopclaude.sh
set -e

echo "=== Deploying ShopClaude Application ==="

# Copy JAR
echo "[1/4] Deploying backend JAR..."
cp /tmp/shopclaude.jar /var/www/theshopclaude/app/shopclaude.jar
chown www-data:www-data /var/www/theshopclaude/app/shopclaude.jar

# Copy frontend dist
echo "[2/4] Deploying frontend..."
rm -rf /var/www/theshopclaude/frontend/*
cp -r /tmp/shopclaude-frontend/* /var/www/theshopclaude/frontend/
chown -R www-data:www-data /var/www/theshopclaude/frontend

# Install updated service file and restart backend
echo "[3/4] Restarting backend service..."
cp /tmp/shopclaude.service /etc/systemd/system/shopclaude.service
systemctl daemon-reload
systemctl restart shopclaude
sleep 5
if systemctl is-active --quiet shopclaude; then
    echo "Backend is running."
else
    echo "ERROR: Backend failed to start. Check logs: journalctl -u shopclaude -n 50"
    exit 1
fi

# Reload Nginx
echo "[4/4] Reloading Nginx..."
nginx -t && systemctl reload nginx

echo ""
echo "=== Deployment complete! ==="
echo "Sites: https://theshopclaude.com and https://*.theshopclaude.com"
echo "Backend health: curl http://localhost:8084/gosuas-core/api/public/products"