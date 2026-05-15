# PLATS v3.0 — Sistema de Agendamiento de Audiencias

**Corte Superior de Justicia de Arequipa**

---

## Contenedores

| # | Nombre | Función | Puerto |
|---|--------|---------|--------|
| 1 | `plats-mock` | Mock del backend Java (solo testing) | interno |
| 2 | `plats-bot` | Bot WhatsApp + panel QR | `3001` |
| 3 | `plats-ui` | Frontend moderno (Vite → Nginx) | interno |
| 4 | `plats-nginx` | Reverse proxy general | `80` |

El backend Java real (`172.28.0.150:8080`) no se containeriza — ya existe en la red judicial.

---

## Despliegue en Oracle Cloud Ubuntu (testing)

### 1. Clonar el repo en la instancia

```bash
git clone https://github.com/TU_USUARIO/plats-sistema.git
cd plats-sistema
```

### 2. Lanzar en modo test (con mock backend)

```bash
bash deploy.sh --mock
```

El script instala Docker automáticamente si no está presente.

### 3. Abrir puertos en Oracle Cloud (OCI)

En la consola de OCI:
1. Ve a **Networking → Virtual Cloud Networks → tu VCN**
2. Entra a **Security Lists** (o Network Security Groups)
3. Agrega reglas de **Ingress**:

| Puerto | Protocolo | Descripción |
|--------|-----------|-------------|
| 80     | TCP       | Frontend PLATS |
| 3001   | TCP       | Panel QR WhatsApp |

### 4. Acceder

| Servicio | URL |
|----------|-----|
| Frontend | `http://IP_PUBLICA` |
| Panel QR bot | `http://IP_PUBLICA:3001` |

---

## Despliegue en producción (red judicial)

```bash
# Editar .env primero
nano .env
# Cambiar PLATS_BASE_URL=http://172.28.0.150:8080/plats

# Editar nginx/nginx.conf
# Comentar: server plats-mock:8080;
# Descomentar: server 172.28.0.150:8080;

bash deploy.sh
```

---

## Comandos útiles

```bash
# Ver logs del bot
docker compose logs -f plats-bot

# Ver logs del mock
docker compose logs -f plats-mock

# Reiniciar un servicio
docker compose restart plats-bot

# Detener todo
docker compose down

# Borrar sesión WhatsApp (re-escanear QR)
rm -rf bot-whatsapp/sessions/*
docker compose restart plats-bot
```

---

## Comandos WhatsApp del bot

| Comando | Descripción |
|---------|-------------|
| `ayuda` | Lista de comandos |
| `hoy` | Agenda del día |
| `consultar 09167-2025-90` | Buscar por expediente |
| `agendar 09167-2025-90 sala1 hoy 09:00-11:00` | Nueva audiencia |
| `audiencia 09167-2025-90 sala1 hoy 09:00-11:00 SOCABAYA` | Completo (agenda + Meet + penal) |
| `meet <id>` | Generar/enviar link de Google Meet |
| `eliminar <id>` | Cancelar audiencia |

---

## Estructura del proyecto

```
plats-sistema/
├── docker-compose.yml
├── deploy.sh
├── .env.example
├── nginx/
│   └── nginx.conf
├── mock-backend/          ← Solo para testing
│   ├── Dockerfile
│   ├── package.json
│   └── server.js
├── bot-whatsapp/
│   ├── Dockerfile
│   ├── package.json
│   ├── sessions/          ← Sesión QR (gitignored)
│   ├── credentials/       ← google.json (gitignored)
│   └── src/
│       ├── index.js
│       ├── commands.js
│       ├── plats-client.js
│       ├── google-meet.js
│       ├── rustdesk.js
│       └── logger.js
└── plats-frontend/
    ├── Dockerfile
    ├── nginx-spa.conf
    ├── package.json
    ├── vite.config.js
    ├── index.html
    ├── public/
    │   ├── pj.svg
    │   └── favicon.svg
    └── src/
        ├── main.js
        └── style.css
```
