# 020 — Panel de administración: base y configuración

| Campo | Valor |
|---|---|
| Estado | **Aprobado** |
| Creado | 2026-10-16 |
| Spec aprobado | 2026-10-16; cambios aprobados el 2026-10-16 |
| Desarrollo aprobado | — |
| Finalizado | — |

## Estado

0 / 9 tareas completadas. Ajustado el 2026-10-16: configuración del monto
diario (spec 023) y del porcentaje de comisión (spec 024); Cambios aprobados el 2026-10-16. Depende de
los specs 003, 004 y 005. Requiere cambios de infraestructura en el spec 002.

## Contexto

El equipo necesita administrar la app durante la demo sin tocar código ni
redesplegar. El panel vive **dentro del backend**: páginas HTML simples
generadas por el servidor, con Bootstrap para el estilo, sin React. Es la base
de los specs 021 (usuarios) y 022 (actividad en vivo).

Este spec cubre el acceso al panel, el diseño común de las páginas y la
configuración editable, empezando por la **URL raíz del proveedor de wallets**
(hoy `https://ilp.interledger-test.dev`).

## Alcance

**Incluye**
- Login y logout del administrador; sesión por cookie.
- Plantilla HTML común (menú, mensajes, formularios) y protección CSRF.
- Página de inicio con un resumen: pagos por estado de las últimas 24 h y estado
  de la conexión con Open Payments.
- Página de configuración editable, guardada en DynamoDB, con historial de cambios.
- Implementación de `SettingsProvider` (spec 003) que lee de DynamoDB con caché.
- Puerto `ActivityLog` (memoria + DynamoDB) para registrar eventos de negocio;
  lo usan este spec, el 021 y el 022. Diseño en el [spec 022](022-panel-admin-actividad.md#diseño).

**No incluye**
- Gestión de usuarios (spec 021) ni actividad en vivo (spec 022).
- Varios administradores o roles (TD-005).
- Editar secretos (llaves, API key) desde el panel: nunca se muestran ni se editan.

## Criterios de aceptación

- **Dado** alguien sin sesión de administrador, **cuando** abre cualquier página
  `/admin`, **entonces** se le redirige al login.
- **Dado** 5 intentos fallidos de login en 15 minutos, **cuando** intenta otra
  vez, **entonces** se bloquea temporalmente sin indicar si la clave era correcta.
- **Dado** un administrador, **cuando** cambia la URL del proveedor de wallets,
  **entonces** el cambio se valida, se guarda, queda en el historial y la API lo
  aplica en máximo 30 segundos en todas las instancias, sin redesplegar.
- **Dado** una URL de proveedor con `http`, IP privada, `localhost` o puerto no
  estándar, **cuando** se guarda, **entonces** se rechaza.
- **Dado** un formulario enviado sin token CSRF válido o desde otro origen,
  **cuando** llega, **entonces** se rechaza con `403`.
- **Dado** cualquier dato mostrado en el panel (descripciones, nombres, URLs),
  **cuando** se renderiza, **entonces** se escapa (sin XSS).

## Diseño

### Rutas

| Ruta | Qué hace |
|---|---|
| `GET /admin/login` · `POST /admin/login` | Formulario de login |
| `POST /admin/logout` | Cierra la sesión |
| `GET /admin` | Inicio: resumen de pagos y estado de Open Payments |
| `GET /admin/settings` · `POST /admin/settings` | Ver y editar la configuración |
| `GET /admin/assets/*` | CSS y JS propios del panel |

Las rutas `/admin` no usan la API key (spec 001): tienen su propio middleware
`adminAuth`. Se desactivan por completo con `ADMIN_ENABLED=false`.

### Acceso del administrador

- Una clave de administrador generada por AWS en Secrets Manager
  (`tranqui/<stage>/admin-password`), comparada en tiempo constante. Se consulta
  con la CLI, igual que la API key.
- Sesión: cookie `tranqui_admin` con un JWT firmado con el secreto de sesión del
  spec 019 (`aud` = `tranqui-admin`), `HttpOnly`, `Secure`, `SameSite=Strict`,
  `Path=/admin`, duración `ADMIN_SESSION_TTL_SECONDS` (8 h).
- Intentos fallidos contados en DynamoDB por IP (TTL 15 min).

### Páginas HTML

- Plantillas con una función `html` (*tagged template*) que **escapa todo por
  defecto**; insertar HTML sin escapar requiere marcarlo de forma explícita.
- Bootstrap 5 (solo CSS) desde jsDelivr con versión exacta e integridad (SRI);
  sin el JavaScript de Bootstrap.
- JavaScript propio mínimo servido desde `/admin/assets` (lo usa el spec 022).
- CSP estricta: `default-src 'self'; style-src 'self' cdn.jsdelivr.net;
  script-src 'self'; frame-ancestors 'none'`.
- Formularios `POST` con token CSRF ligado a la sesión, más verificación del
  header `Origin`. Las acciones que modifican nunca usan `GET`.

### Configuración editable

| Clave | Por defecto (del entorno) | Validación |
|---|---|---|
| `walletProviderBaseUrl` | `WALLET_PROVIDER_BASE_URL` | `https`, sin IP privada ni `localhost`, puerto 443, sin credenciales ni query |
| `allowedWalletHosts` | `ALLOWED_WALLET_HOSTS` | Lista de hosts con las mismas reglas |
| `maxPaymentAmounts` | `MAX_PAYMENT_AMOUNTS` | `CODIGO:monto` por moneda, montos positivos |
| `dailySpendLimits` | `DAILY_SPEND_LIMITS` | `CODIGO:monto` por moneda; aplica a las vinculaciones nuevas (spec 023) |
| `feePercentage` | `FEE_PERCENTAGE` (`0`) | 0–10, hasta 3 decimales; aplica a las cotizaciones nuevas (spec 024) |
| `linkAuthTtlSeconds` | `LINK_AUTH_TTL_SECONDS` | 60–3600; tiempo para aprobar la vinculación en la wallet |
| `frontendResultUrl` | `FRONTEND_RESULT_URL` | `https` o vacío |
| `paymentsEnabled` | `true` | Interruptor: en `false`, `POST /payments` y `POST /payment-requests` responden `503 PAYMENTS_DISABLED` |

- Se guardan en un solo registro `cfg_settings` con número de versión
  (actualización condicional: si dos administradores guardan a la vez, el
  segundo ve un aviso y recarga).
- Lo no guardado en DynamoDB toma el valor del entorno.
- `SettingsProvider` mantiene una caché por instancia de 30 s.
- Cada cambio registra un evento `settings.updated` con valor anterior y nuevo
  en el `ActivityLog`; la página de configuración muestra los últimos 20.
- Al cambiar el proveedor, el panel advierte que las wallets registradas con el
  proveedor anterior dejarán de estar permitidas.

### Estado de Open Payments (inicio)

Consulta la wallet de la plataforma (`getWalletAddress`) con timeout corto y
muestra "conectado" o el error. Sirve para detectar rápido si el proveedor
configurado responde.

## Casos de prueba

| # | Tipo | Caso | Esperado |
|---|---|---|---|
| 1 | Integration | `/admin` y `/admin/settings` sin sesión | `302` a `/admin/login` |
| 2 | Integration | Login correcto / incorrecto | Cookie con atributos `HttpOnly`, `Secure`, `SameSite=Strict` / mensaje genérico |
| 3 | Integration | Sexto intento fallido en 15 minutos | Bloqueado, aunque la clave sea correcta |
| 4 | Integration | Cookie de sesión de usuario de la app (`aud` distinto) en `/admin` | Rechazada |
| 5 | Integration | `POST` sin token CSRF / con `Origin` ajeno | `403` |
| 6 | Integration | Guardar `walletProviderBaseUrl` válida | Guardada; evento `settings.updated`; `SettingsProvider` la devuelve tras vencer la caché |
| 7 | Integration | URLs inválidas: `http://`, `https://10.0.0.1`, `https://localhost`, `https://x:8443`, `https://u:p@x` | Rechazadas con mensaje por campo |
| 8 | Integration | Dos guardados con la misma versión | El segundo recibe aviso de conflicto |
| 9 | Integration | `paymentsEnabled=false` | `POST /payments` → `503 PAYMENTS_DISABLED` |
| 10 | Unit | Función `html` con `<script>`, comillas y `&` | Texto escapado |
| 11 | Integration | Headers del panel | CSP, `X-Frame-Options`/`frame-ancestors`, sin cache (`no-store`) |
| 12 | Integration | `ADMIN_ENABLED=false` | `/admin/*` responde `404` |
| 13 | Contrato | `SettingsProvider` de entorno y de DynamoDB | Mismos valores por defecto |
| 14 | Contrato | `ActivityLog` en memoria y DynamoDB: guardar, listar después de un cursor, filtrar por pago; TTL de 7 días | Mismos resultados, en orden |
| 15 | Unit | Evento con datos que incluyen tokens, nonces, `hash` o llaves | No aparecen en el evento guardado |

## Tareas

1. [ ] Función `html` con escape y plantilla común (caso 10).
2. [ ] Puerto `ActivityLog` con campos permitidos por evento, en memoria y DynamoDB (casos 14–15).
3. [ ] Login, logout, `adminAuth`, CSRF y bloqueo por intentos (casos 1–5, 12).
4. [ ] `SettingsProvider` en DynamoDB con caché y tests de contrato (caso 13).
5. [ ] Página de configuración con validación, conflicto e historial (casos 6–8).
6. [ ] Interruptor `paymentsEnabled` (caso 9).
7. [ ] Página de inicio con resumen y estado de Open Payments.
8. [ ] Headers de seguridad del panel (caso 11).
9. [ ] Suite completa en verde, lint y typecheck limpios.

## Decisiones

| # | Tema | Decisión |
|---|---|---|
| 1 | Estilos | Bootstrap 5 (solo CSS) por CDN con SRI (2026-10-16) |
| 2 | Acceso del administrador | Clave en Secrets Manager (2026-10-16); passkeys para administradores en TD-005 |

## Decisiones pendientes

Ninguna.

## Notas

- Configuración nueva: `ADMIN_ENABLED` (por defecto `true` en `dev`),
  `ADMIN_PASSWORD_SECRET_ARN`, `ADMIN_SESSION_TTL_SECONDS`.
- Infraestructura (spec 002, tarea 20): secreto `admin-password` generado por AWS e índice `byPayment`.
