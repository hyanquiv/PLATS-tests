# PLATS v3.0 — Sistema de Agendamiento de Audiencias
**Corte Superior de Justicia de Arequipa**

## Contenedores

| # | Nombre | Función | Puerto |
|---|--------|---------|--------|
| 1 | `plats-postgres` | Base de datos PostgreSQL | `5432` |
| 2 | `plats-openwa` | Gateway WhatsApp + QR dashboard | `8083` |
| 3 | `plats-mock` | Mock backend Java (solo testing) | interno |
| 4 | `plats-bot` | Lógica del bot + webhooks | `3001` |
| 5 | `plats-ui` | Frontend moderno (Vite → Nginx) | interno |
| 6 | `plats-nginx` | Reverse proxy general | `80` |

## Despliegue Oracle Cloud (testing)

```bash
git clone https://github.com/TU_USUARIO/plats-sistema.git
cd plats-sistema
bash deploy.sh --mock
```

## Puertos a abrir en OCI Security Lists

| Puerto | Uso |
|--------|-----|
| 80 | Frontend web |
| 3001 | Panel estado bot |
| 8083 | Dashboard QR WhatsApp |

## Comandos útiles

```bash
docker compose --profile mock up -d          # levantar todo (test)
docker compose logs -f plats-bot             # logs del bot
docker compose logs -f plats-openwa          # logs WhatsApp
docker compose exec plats-bot npm test       # correr tests
docker compose exec plats-postgres psql -U plats -d plats  # BD
docker compose down                          # detener todo
```

## Tests incluidos

```bash
# Validators (27 tests)
node src/utils/validators.test.js

# Overlap (15 tests)
node src/utils/overlap.test.js
```

## Flujo interactivo WhatsApp (sin escribir comandos)

```
Hola → Menú [botones]
  → Nueva audiencia
    → Sede [lista]
    → Juzgado [lista]
    → Sala [lista]
    → Fecha [lista - próx 7 días]
    → Horario [lista - SOLO slots libres]
    → Internos [texto validado con regex]
    → Expediente [texto validado con regex]
    → Penal [lista - con email Calendar]
    → Confirmar [botones]
      → ✅ Agenda + Meet + invita penal + conecta RustDesk
```

## Estructura

```
plats-sistema/
├── docker-compose.yml
├── deploy.sh
├── .env.example
├── nginx/nginx.conf
├── postgres/schema.sql          ← Esquema BD + datos semilla
├── mock-backend/                ← Solo testing
├── openwa/                      ← Configuración gateway WA
├── bot-whatsapp/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── index.js             ← Servidor webhook
│       ├── router.js            ← Despacha mensajes/botones/listas
│       ├── openwa-client.js     ← API REST de OpenWA
│       ├── plats-client.js      ← API REST del backend Java
│       ├── db.js                ← PostgreSQL + validador overlap
│       ├── agenda-image.js      ← Genera PNG de la agenda
│       ├── google-meet.js       ← Google Calendar API
│       ├── rustdesk.js          ← Conexión automática al penal
│       ├── handlers/
│       │   ├── agendar.js       ← Flujo 9 pasos
│       │   └── consultar.js     ← Agenda + búsqueda
│       └── utils/
│           ├── validators.js    ← Regex + normalización
│           ├── session-flow.js  ← Estado por usuario (15 min TTL)
│           ├── validators.test.js
│           └── overlap.test.js
└── plats-frontend/              ← UI web moderna
```
