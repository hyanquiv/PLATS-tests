#!/bin/bash
set -e
MOCK=false
[[ "$1" == "--mock" ]] && MOCK=true

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║  PLATS v3.0 — Corte Superior de Justicia Arequipa    ║"
echo "╚═══════════════════════════════════════════════════════╝"
[[ "$MOCK" == "true" ]] && echo "  ⚗️  Modo: TEST (mock backend)" || echo "  🏛️  Modo: PRODUCCIÓN"
echo ""

# Instalar Docker si no está
if ! command -v docker &>/dev/null; then
  echo "📦 Instalando Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER
fi

# Abrir puertos Oracle/Ubuntu
echo "🔒 Configurando firewall..."
for PORT in 80 3001 8083; do
  sudo iptables -I INPUT -p tcp --dport $PORT -j ACCEPT 2>/dev/null || true
  command -v ufw &>/dev/null && sudo ufw allow $PORT/tcp 2>/dev/null || true
done

# .env
if [ ! -f .env ]; then
  cp .env.example .env
  echo "  ⚠️  Edita .env antes de continuar: nano .env"
fi

mkdir -p bot-whatsapp/sessions bot-whatsapp/credentials

echo "🐳 Construyendo imágenes..."
if [ "$MOCK" == "true" ]; then
  docker compose --profile mock build
  echo "🚀 Iniciando (modo test con mock)..."
  docker compose --profile mock up -d
else
  docker compose build
  echo "🚀 Iniciando..."
  docker compose up -d
fi

IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║  ✅ Sistema iniciado                                  ║"
echo "╠═══════════════════════════════════════════════════════╣"
printf "║  🌐 Frontend:    http://%-32s║\n" "$IP"
printf "║  📱 Panel QR WA: http://%-29s║\n" "$IP:8083"
printf "║  🤖 Bot estado:  http://%-29s║\n" "$IP:3001"
echo "╠═══════════════════════════════════════════════════════╣"
echo "║  docker compose logs -f plats-bot                    ║"
echo "║  docker compose logs -f plats-openwa                 ║"
echo "║  docker compose ps                                    ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""
echo "  ⚠️  ORACLE CLOUD: abre puertos 80, 3001 y 8083"
echo "     en Security Lists / Network Security Groups (OCI)"
echo ""
