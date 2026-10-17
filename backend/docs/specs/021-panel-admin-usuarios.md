# 021 — Panel de administración: gestión de usuarios

| Campo | Valor |
|---|---|
| Estado | **Aprobado** |
| Creado | 2026-10-16 |
| Spec aprobado | 2026-10-16; cambios aprobados el 2026-10-16 |
| Desarrollo aprobado | — |
| Finalizado | — |

## Estado

0 / 7 tareas completadas. Ajustado el 2026-10-16 por el monto diario
preaprobado (spec 023); Cambios aprobados el 2026-10-16. Depende de
los specs 019 y 020 (usa su `ActivityLog`).

## Contexto

Durante la demo hay que poder ver y administrar los usuarios de la app: crear,
consultar, editar, bloquear, borrar y "cambiar la clave".

**Los usuarios no tienen clave**: entran con passkey (spec 019), y el passkey
vive en el dispositivo del usuario, así que el administrador no puede crearlo
ni cambiarlo por él. El equivalente a cambiar la clave es **restablecer el
acceso**: el administrador revoca los passkeys del usuario y genera un enlace
de un solo uso para que registre uno nuevo desde su dispositivo. Es el mismo
flujo que usan los servicios con passkeys para recuperar cuentas.

## Alcance

**Incluye**
- Lista de usuarios con búsqueda (nombre o wallet) y paginación.
- Detalle: datos, passkeys (fecha de creación, último uso, si está
  sincronizado), vinculación de la wallet (estado, monto diario, gastado hoy) y
  últimos pagos de su wallet.
- Revocar la vinculación de la wallet (cancela el grant; el usuario debe volver
  a vincular para pagar).
- Crear usuario: nombre y wallet; devuelve un enlace de registro del passkey.
- Editar nombre, wallet y estado (`ACTIVE` · `BLOCKED`).
- Borrar usuario (mismo efecto que `DELETE /me` del spec 019).
- Restablecer acceso: revocar un passkey o todos, y generar enlace de registro.
- Extensión del spec 019: registro de passkey con enlace (`enrollmentToken`).

**No incluye**
- Ver o cambiar el passkey en sí (imposible: es privado del dispositivo).
- Contraseñas para usuarios (ver Decisiones pendientes).

## Criterios de aceptación

- **Dado** un administrador, **cuando** crea un usuario, **entonces** la cuenta
  queda sin passkey y el panel muestra un enlace de registro válido por 24 h.
- **Dado** un enlace de registro, **cuando** el usuario lo abre y crea su
  passkey, **entonces** queda asociado a esa cuenta y el enlace deja de servir.
- **Dado** un administrador que restablece el acceso, **cuando** confirma,
  **entonces** se borran los passkeys elegidos, las sesiones activas dejan de
  servir y se genera un enlace nuevo; los enlaces anteriores quedan invalidados.
- **Dado** un usuario bloqueado, **cuando** intenta iniciar sesión o usar una
  sesión, **entonces** recibe `401`.
- **Dado** un cambio de wallet a una ya registrada, **cuando** se guarda,
  **entonces** se rechaza.
- **Dado** cualquier acción del administrador, **cuando** se ejecuta, **entonces**
  queda un evento en el historial (`user.created`, `user.updated`,
  `user.blocked`, `user.deleted`, `user.access_reset`).

## Diseño

### Rutas del panel

| Ruta | Qué hace |
|---|---|
| `GET /admin/users?q=&cursor=` | Lista y búsqueda |
| `GET /admin/users/new` · `POST /admin/users` | Crear |
| `GET /admin/users/{id}` | Detalle |
| `GET /admin/users/{id}/edit` · `POST /admin/users/{id}` | Editar (incluye bloquear y desbloquear) |
| `POST /admin/users/{id}/delete` | Borrar (con confirmación) |
| `POST /admin/users/{id}/reset-access` | Revocar passkeys (uno o todos) y generar enlace |

Todas usan la sesión, CSRF y la plantilla del spec 020.

### Enlace de registro

- Token aleatorio de 32 bytes; se guarda solo su hash (`enr_<sha256>`) con
  `userId` y TTL de 24 h. Se muestra una sola vez en el panel.
- Enlace: `{FRONTEND_URL}/enroll?token=…`. Mientras no exista el frontend, la
  página HTML de prueba del spec 019.
- **No se envían correos ni notificaciones.** El panel muestra el enlace con un
  botón "Copiar" y el administrador lo comparte a mano (WhatsApp u otro medio).
- `POST /api/v1/auth/register/options` acepta `{ enrollmentToken }` en vez de
  `displayName` y `walletAddress`: el passkey se asocia a la cuenta existente.
  El token se consume con actualización condicional al verificar.

### Cortar las sesiones al restablecer

Cada usuario tiene `sessionVersion`. El JWT la incluye y `userAuth` (spec 019)
la compara; al restablecer el acceso, bloquear o borrar se incrementa y todas
las sesiones previas dejan de servir.

### Búsqueda

Con pocos usuarios (demo), la lista se obtiene del índice `byType` y se filtra
por nombre o wallet en la Lambda. Si crece, se agrega un índice por wallet.

## Casos de prueba

| # | Tipo | Caso | Esperado |
|---|---|---|---|
| 1 | Integration | Lista con 0, 5 y 30 usuarios; búsqueda por nombre y por wallet | Paginada; resultados correctos |
| 2 | Integration | Crear con datos válidos / wallet ya registrada / wallet inexistente | Usuario y enlace / error en el formulario |
| 3 | Integration | Registrar passkey con enlace válido / usado / vencido / de un restablecimiento anterior | Asociado a la cuenta / `400 CHALLENGE_EXPIRED` en los demás |
| 4 | Integration | Editar nombre y wallet | Guardado; unicidad de wallet actualizada |
| 5 | Integration | Bloquear y desbloquear | Login y sesiones rechazados / vuelven a funcionar |
| 6 | Integration | Restablecer acceso (un passkey / todos) | Passkeys borrados; sesión previa → `401`; enlace nuevo |
| 7 | Integration | Borrar usuario | Usuario, passkeys y unicidad borrados; pagos intactos |
| 8 | Integration | Cada acción genera su evento | Eventos con el ID del usuario, sin datos sensibles |
| 9 | Integration | Nombre con `<script>` en lista y detalle | Mostrado escapado |
| 10 | Integration | Rutas sin sesión de administrador o sin CSRF | `302` al login / `403` |

## Tareas

1. [ ] Métodos nuevos de `UsersRepository` (lista, actualizar, `sessionVersion`) en ambas implementaciones.
2. [ ] Enlace de registro y extensión de `register/options` (caso 3).
3. [ ] Lista, búsqueda y detalle (casos 1 y 9).
4. [ ] Crear, editar, bloquear y borrar (casos 2, 4, 5 y 7).
5. [ ] Restablecer acceso y corte de sesiones (caso 6).
6. [ ] Eventos de auditoría y protección de rutas (casos 8 y 10).
7. [ ] Suite completa en verde, lint y typecheck limpios.

## Decisiones

| # | Tema | Decisión |
|---|---|---|
| 1 | "Cambio de clave" | Restablecer el acceso con enlace de registro (2026-10-16) |
| 2 | Entrega del enlace | Sin correo ni notificaciones: el panel muestra el enlace y el administrador lo copia y lo comparte a mano (WhatsApp u otro medio) |

## Decisiones pendientes

Ninguna.
