#!/usr/bin/env bash
# 在 kong8la 服务器上挂载 /plant1/ 静态站（幂等）
# 由 deploy/publish.ps1 通过 ssh 调起；也可以手动执行。
set -euo pipefail

SITE=/var/www/northline/plant1
CONF=/etc/nginx/sites-enabled/northline
TS=$(date +%Y%m%d-%H%M%S)

[ -d "$SITE" ] || { echo "missing $SITE (先上传文件)" >&2; exit 1; }

# scp 从 Windows 过来时目录会是 700，nginx 读不了
find "$SITE" -type d -exec chmod 755 {} +
find "$SITE" -type f -exec chmod 644 {} +

cp -a "$CONF" "/root/northline.$TS.bak"
cp -a /etc/nginx/mime.types "/root/mime.types.$TS.bak" 2>/dev/null || true

# .webmanifest 的 MIME（否则 PWA 安装提示不出现）
if ! grep -q 'webmanifest' /etc/nginx/mime.types; then
  sed -i '/^types {/a\    application/manifest+json  webmanifest;' /etc/nginx/mime.types
  echo "mime.types: + application/manifest+json"
fi

# 只插入一次；锚点是 server 块里的 location ~ /\. { deny all; }
if ! grep -q 'PLANT-1' "$CONF"; then
  python3 - "$CONF" <<'PY'
import sys
path = sys.argv[1]
src = open(path, encoding='utf-8').read()
block = '''    # PLANT-1 · Phase Plant 复刻的 FM-1 浏览器固件（静态）
    location = /plant1 { return 301 /plant1/; }
    location ^~ /plant1/ {
        root /var/www/northline;
        index index.html;
        try_files $uri $uri/ =404;
        autoindex off;
        add_header Cache-Control "no-cache";
        add_header X-Content-Type-Options nosniff always;
        add_header Referrer-Policy strict-origin-when-cross-origin always;
        add_header X-Frame-Options SAMEORIGIN always;
    }
'''
marker = '    location ~ /\\. { deny all; }'
if marker not in src:
    sys.exit('anchor not found: ' + marker)
src = src.replace(marker, block + marker, 1)
open(path, 'w', encoding='utf-8').write(src)
print('nginx: location /plant1/ inserted')
PY
else
  echo "nginx: location /plant1/ already present"
fi

nginx -t
systemctl reload nginx

echo "check:"
for u in /plant1/ /plant1/play/ /plant1/install/ /plant1/flash/ \
         /plant1/play/manifest.webmanifest /plant1/play/sw.js /plant1/flash/vendor/fm1ota.js; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "https://kong8la.com$u")
  type=$(curl -s -o /dev/null -w '%{content_type}' "https://kong8la.com$u")
  printf '  %-42s %s  %s\n' "$u" "$code" "$type"
done
