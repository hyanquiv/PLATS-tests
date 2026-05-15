#!/bin/bash
# ══════════════════════════════════════════════════════════════
#  deploy.sh — PLATS v3.0
#  Instala Docker si no existe y levanta todos los servicios.
#
#  MODO TEST (Oracle Cloud / sin backend Java):
#    bash deploy.sh --mock
#
#  MODO PRODUCCIÓN (con backend Java en red judicial):
#    bash deploy.sh
# ══════════════════════════════════════════════════════════════
set -e

MOCK=false
[[ "$1" == "--mock" ]] && MOCK=true

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║  PLATS v3.0 — Corte Superior de Justicia Arequipa    ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""
[[ "$MOCK" == "true" ]] && echo "  ⚗️  Modo: TEST con mock backend" \
                        || echo "  🏛️  Modo: PRODUCCIÓN"
echo ""

# ── 1. Instalar Docker si no está ─────────────────────────────
if ! command -v docker &>/dev/null; then
  echo "📦 Instalando Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER
  echo "✅ Docker instalado"
fi

if ! command -v docker &>/dev/null || ! docker compose version &>/dev/null; then
  echo "📦 Instalando Docker Compose plugin..."
  sudo apt-get update -qq
  sudo apt-get install -y docker-compose-plugin
fi

# ── 2. Abrir puertos en el firewall Ubuntu (iptables / ufw) ───
echo "🔒 Configurando firewall..."
if command -v ufw &>/dev/null; then
  sudo ufw allow 80/tcp   comment "PLATS Frontend" 2>/dev/null || true
  sudo ufw allow 3001/tcp comment "PLATS Bot QR"   2>/dev/null || true
  sudo ufw --force enable 2>/dev/null || true
fi
# Oracle Cloud usa iptables — abrir también por si acaso
sudo iptables -I INPUT -p tcp --dport 80   -j ACCEPT 2>/dev/null || true
sudo iptables -I INPUT -p tcp --dport 3001 -j ACCEPT 2>/dev/null || true

# ── 3. Crear .env si no existe ─────────────────────────────────
if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo "  📋 Se creó el archivo .env con valores por defecto."
  echo "     Edítalo si necesitas cambiar teléfono admin o credenciales:"
  echo "     nano .env"
  echo ""
fi

# ── 4. Crear carpetas de volúmenes ─────────────────────────────
mkdir -p bot-whatsapp/sessions
mkdir -p bot-whatsapp/credentials

# ── 5. Build y up ──────────────────────────────────────────────
echo "🐳 Construyendo imágenes..."

if [ "$MOCK" == "true" ]; then
  docker compose --profile mock build
  echo "🚀 Iniciando servicios (con mock backend)..."
  docker compose --profile mock up -d
else
  docker compose build
  echo "🚀 Iniciando servicios..."
  docker compose up -d
fi

# ── 6. Info final ──────────────────────────────────────────────
IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║  ✅ Sistema iniciado                                  ║"
echo "╠═══════════════════════════════════════════════════════╣"
printf "║  🌐 Frontend:   http://%-31s ║\n" "$IP"
printf "║  📱 Panel QR:   http://%-28s ║\n" "$IP:3001"
echo "╠═══════════════════════════════════════════════════════╣"
echo "║  Comandos útiles:                                     ║"
echo "║  docker compose logs -f plats-bot                    ║"
echo "║  docker compose logs -f plats-mock                   ║"
echo "║  docker compose ps                                    ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""
echo "  ⚠️  ORACLE CLOUD: Recuerda abrir los puertos 80 y 3001"
echo "     en las Security Lists / Network Security Groups de OCI."
echo ""
