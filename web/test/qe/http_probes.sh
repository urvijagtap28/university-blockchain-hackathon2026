#!/bin/bash
# QE_WEB_SECURITY: curl probes against a RUNNING local instance on 127.0.0.1 only. No keys, no payments. Usage: http_probes.sh [port]
PORT=${1:-4032}; B=http://127.0.0.1:$PORT; TMP=$(mktemp)
c(){ printf '%-42s' "$1"; shift; curl -s -m5 -o "$TMP" -w "%{http_code} " "$@"; head -c 80 "$TMP" | tr '\n' ' '; echo; }
echo "--- Host"
c "good" $B/api/config
for h in evil.com 127.0.0.1.evil.com "[::1]:$PORT" "127.0.0.1:$PORT." "LOCALHOST:$PORT" "127.0.0.1:$((PORT+1))" "127.0.0.1" "localhost:$PORT" "127.0.0.1:$PORT, evil.com" "0.0.0.0:$PORT" "2130706433:$PORT"; do c "Host: $h" -H "Host: $h" $B/api/config; done
printf 'GET /api/config HTTP/1.0\r\n\r\n' | nc -w2 127.0.0.1 $PORT | head -1 | sed 's/^/HTTP1.0 no Host: /'
printf 'GET /api/config HTTP/1.1\r\n\r\n' | nc -w2 127.0.0.1 $PORT | head -1 | sed 's/^/HTTP1.1 no Host: /'
c "abs-URI evil.com, good Host" --request-target "http://evil.com/api/config" $B
echo "--- Origin / CSRF"
T=$(curl -s $B/api/config | sed 's/.*"csrfToken":"\([0-9a-f]*\)".*/\1/')
P='{"reportHash":"'$(printf 'a%.0s' {1..64})'","decision":"valid","text":"x"}'
O="Origin: http://127.0.0.1:$PORT"
c "no origin, good token" -X POST -H "x-csrf-token: $T" -d "$P" $B/api/notes
c "origin null" -X POST -H "Origin: null" -H "x-csrf-token: $T" -d "$P" $B/api/notes
c "origin evil" -X POST -H "Origin: http://evil.com" -H "x-csrf-token: $T" -d "$P" $B/api/notes
c "origin other port" -X POST -H "Origin: http://127.0.0.1:$((PORT+1))" -H "x-csrf-token: $T" -d "$P" $B/api/notes
c "origin localhost same port" -X POST -H "Origin: http://localhost:$PORT" -H "x-csrf-token: $T" -d "$P" $B/api/notes
c "origin https" -X POST -H "Origin: https://127.0.0.1:$PORT" -H "x-csrf-token: $T" -d "$P" $B/api/notes
c "origin ok, no token" -X POST -H "$O" -d "$P" $B/api/notes
c "origin ok, wrong token" -X POST -H "$O" -H "x-csrf-token: ${T:0:47}0" -d "$P" $B/api/notes
c "origin ok, token only in URL" -X POST -H "$O" -d "$P" "$B/api/notes?csrf=$T&x-csrf-token=$T"
c "origin ok, empty token" -X POST -H "$O" -H "x-csrf-token:" -d "$P" $B/api/notes
c "origin ok+token, no log record" -X POST -H "$O" -H "x-csrf-token: $T" -d "$P" $B/api/notes
c "submit no csrf" -X POST -H "$O" -d x $B/api/submit
c "unknown POST route (no csrf)" -X POST -H "$O" $B/api/nope
c "PUT" -X PUT -H "$O" -H "x-csrf-token: $T" $B/api/submit
c "DELETE" -X DELETE $B/api/config
echo "--- CORS"
for p in /api/config /api/notes /api/submit / /app.js /api/log; do printf '%-14s' $p; curl -s -i -X OPTIONS -H "Origin: http://evil.com" -H "Access-Control-Request-Method: POST" $B$p | tr -d '\r' | grep -iE "^HTTP|access-control|^allow" | tr '\n' '|'; echo; done
echo -n "ACAO on evil-origin GET: "; curl -s -i -H "Origin: http://evil.com" $B/api/config | grep -ic "access-control"
echo "--- headers"
for p in /api/config / /app.js /api/nope /nope.js; do echo "## $p"; curl -s -i $B$p | tr -d '\r' | sed -n '1,/^$/p' | grep -viE "^date|^connection|^keep-alive"; done
echo "--- static traversal"
for p in "/../server.mjs" "/%2e%2e/server.mjs" "/%252e%252e/server.mjs" "/..%2fserver.mjs" "/..%5cserver.mjs" "/..\\server.mjs" "/web/data/notes.jsonl" "/data/notes.jsonl" "/.env" "/keys/" "/keys" "/../.env" "/../../.env" "/./app.js" "//app.js" "/app.js/" "/app.js%00.html" "/app.js?x=1" "/." "/.git/config" "/index.html" "/styles.css" "/fixtures/config.stub.json" "/api" "/api/" "/APP.JS"; do c "$p" --path-as-is "$B$p"; done
c "http://127.0.0.1/../" --path-as-is "$B/a/../../server.mjs"
c "HEAD /app.js" -I $B/app.js
rm -f "$TMP"
