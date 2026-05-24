#!/bin/bash
set -e
MOCK=false
[[ "$1" == "--mock" ]] && MOCK=true

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║  PLATS v3.0 — Corte Superior de Justicia Arequipa    ║"
echo "╚═══════════════════════════════════════════════════════╝"
[[ "$MOCK" == "true" ]] && echo "  ⚗️  Modo: TEST" || echo "  🏛️  Modo: PRODUCCIÓN"
echo ""

if ! command -v docker &>/dev/null; then
  echo "📦 Instalando Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER
  newgrp docker
fi

echo "🔒 Configurando firewall..."
for PORT in 80 3001 8083; do
  sudo iptables -I INPUT -p tcp --dport $PORT -j ACCEPT 2>/dev/null || true
  command -v ufw &>/dev/null && sudo ufw allow $PORT/tcp 2>/dev/null || true
done

[ ! -f .env ] && cp .env.example .env
mkdir -p bot-whatsapp/sessions bot-whatsapp/credentials

echo "🐳 Construyendo imágenes..."
if [ "$MOCK" == "true" ]; then
  docker compose --profile mock build
  echo "🚀 Iniciando (modo test)..."
  docker compose --profile mock up -d
else
  docker compose build
  docker compose up -d
fi

IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║  ✅ Sistema iniciado                                  ║"
echo "╠═══════════════════════════════════════════════════════╣"
printf "║  🌐 Frontend:    http://%-32s║\n" "$IP"
printf "║  📱 QR WhatsApp: http://%-29s║\n" "$IP:8083"
printf "║  🤖 Bot estado:  http://%-29s║\n" "$IP:3001"
echo "╠═══════════════════════════════════════════════════════╣"
echo "║  docker compose logs -f plats-openwa                 ║"
echo "║  docker compose logs -f plats-bot                    ║"
echo "║  docker compose ps                                    ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""
echo "  ⚠️  ORACLE CLOUD: abre puertos 80, 3001 y 8083 en OCI"
echo ""
