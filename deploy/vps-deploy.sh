#!/bin/bash
# Run this script ON the VPS as root after files are uploaded:  bash vps-deploy.sh
set -e

echo "=== Deploying GOSUAS Application ==="

# Copy JAR
echo "[1/4] Deploying backend JAR..."
cp /tmp/gosuas.jar /var/www/gosuas/app/gosuas.jar
chown www-data:www-data /var/www/gosuas/app/gosuas.jar

# Copy frontend dist — same multi-tenant build serves both vhosts:
#   sales.gosuas.com        -> /var/www/gosuas/frontend
#   *.theshopclaude.com     -> /var/www/theshopclaude/frontend
# Both must stay in sync or ShopClaude tenants silently run a stale build.
echo "[2/4] Deploying frontend..."
rm -rf /var/www/gosuas/frontend/*
cp -r /tmp/gosuas-frontend/* /var/www/gosuas/frontend/
chown -R www-data:www-data /var/www/gosuas/frontend

if [ -d /var/www/theshopclaude/frontend ]; then
    rm -rf /var/www/theshopclaude/frontend/*
    cp -r /tmp/gosuas-frontend/* /var/www/theshopclaude/frontend/
    chown -R www-data:www-data /var/www/theshopclaude/frontend
fi

# Install updated service file and restart backend
echo "[3/4] Restarting backend service..."
cp /tmp/gosuas.service /etc/systemd/system/gosuas.service
systemctl daemon-reload
systemctl restart gosuas
sleep 5
if systemctl is-active --quiet gosuas; then
    echo "Backend is running."
else
    echo "ERROR: Backend failed to start. Check logs: journalctl -u gosuas -n 50"
    exit 1
fi

# Reload Nginx
echo "[4/4] Reloading Nginx..."
nginx -t && systemctl reload nginx

echo ""
echo "=== Deployment complete! ==="
echo "Sites: http://sales.gosuas.com  and  https://*.theshopclaude.com"
echo "Backend health: curl http://localhost:8081/gosuas-core/api/public/products"
echo ""
echo "To enable HTTPS, run:"
echo "  certbot --nginx -d sales.gosuas.com --non-interactive --agree-tos -m mayaorez23@gmail.com"
