# 011 — Registro

| Campo | Valor |
|---|---|
| Estado | **Borrador** |
| Creado | 2026-10-16 |
| Spec aprobado | — |
| Desarrollo aprobado | — |
| Finalizado | — |

## Estado

0 / 6 tareas completadas. Spec en borrador, pendiente de aprobación.

## Contexto

Para pagar, la app necesita saber quién es el usuario y desde qué wallet paga.
El usuario se registra con su nombre, correo, la dirección de su wallet y un
PIN. Los mockups 1.1 – 1.4 muestran un registro con banco y permiso guardado;
se reemplaza por este (ver [PLAN.md](../PLAN.md#diferencias-con-los-mockups)).
El usuario **no** entrega llaves ni la clave de su wallet: solo su dirección
pública ([API.md](../../../backend/docs/API.md#identidad-de-la-api-cliente-open-payments)).

## Alcance

**Incluye**
- Pantalla de registro: nombre, correo, dirección de la wallet, PIN y confirmación del PIN.
- Validación en el cliente (Zod) y verificación de la wallet antes de enviar.
- Llamada a `POST /api/v1/users`; con éxito, inicia la sesión con el token recibido (`signIn` del spec 012) y lleva al inicio.
- Componente `PinField`.

**No incluye**
- Bienvenida, inicio de sesión, cierre y eliminación de cuenta (spec 012).
- Verificación del correo, recuperación del PIN, passkeys.
- El endpoint del backend (spec de backend por escribir; aquí se usa MSW).

## Criterios de aceptación

- **Dado** el formulario vacío, **cuando** toca "Crear cuenta", **entonces** cada campo obligatorio muestra su error y no se llama a la API.
- **Dado** un correo con formato inválido, **cuando** sale del campo, **entonces** ve "Escriba un correo válido".
- **Dado** un PIN que no son 6 dígitos, o una confirmación distinta, **cuando** envía, **entonces** ve el error del campo.
- **Dado** un PIN trivial (`000000`, `123456`, seis dígitos iguales o consecutivos), **cuando** envía, **entonces** ve "Escoja un PIN más difícil de adivinar".
- **Dado** una dirección de wallet sin `https://` o mal formada, **cuando** sale del campo, **entonces** ve el error; si escribe `$ilp.interledger-test.dev/ana`, se normaliza a `https://ilp.interledger-test.dev/ana`.
- **Dado** una wallet válida, **cuando** sale del campo, **entonces** la app la verifica y muestra "Wallet encontrada · <publicName> · <assetCode>", o "No encontramos esa wallet" si no existe.
- **Dado** datos válidos, **cuando** toca "Crear cuenta", **entonces** el botón queda en carga, se llama `POST /users` una sola vez y al recibir `201` queda con sesión y ve el inicio.
- **Dado** que el correo ya está registrado (`409 EMAIL_ALREADY_REGISTERED`), **cuando** envía, **entonces** ve el error en el campo correo y un enlace a "Ingresar".
- **Dado** un error de red, **cuando** envía, **entonces** ve un mensaje para reintentar y los datos escritos se conservan (excepto el PIN, que se borra).

## Diseño

### Ruta

`app/(publico)/registro.tsx`.

### Formulario

| Campo | Regla | Teclado |
|---|---|---|
| Nombre | 2–60 caracteres, sin solo espacios | texto, `autoComplete="name"` |
| Correo | Formato de correo, se guarda en minúsculas y sin espacios | `email-address`, `autoComplete="email"` |
| Dirección de la wallet | `https://` + host + ruta; acepta *payment pointer* `$host/ruta` y lo normaliza | `url`, sin autocorrección |
| PIN | Exactamente 6 dígitos, no trivial | numérico, oculto |
| Confirmar PIN | Igual al PIN | numérico, oculto |

El schema vive en `src/features/auth/schemas.ts`.

### Contrato (propuesto al backend)

```
GET  /api/v1/wallets/verify?walletAddress=<url>
     200 { "exists": true, "publicName": "Claudia", "assetCode": "COP", "assetScale": 2 }
     422 WALLET_NOT_FOUND | WALLET_NOT_ALLOWED

POST /api/v1/users
     { "name": "Claudia Pérez", "email": "claudia@example.com",
       "walletAddress": "https://ilp.interledger-test.dev/claudia", "pin": "482915" }
     201 { "user": { "id": "usr_...", "name": "...", "email": "...", "walletAddress": "...", "assetCode": "COP" },
           "token": "<jwt>", "expiresAt": "..." }
     409 EMAIL_ALREADY_REGISTERED · 422 WALLET_NOT_FOUND · 400 VALIDATION_ERROR
```

### Seguridad

- El PIN no se guarda en estado global ni en almacenamiento; se borra del
  formulario tras enviar o fallar.
- Las reglas de PIN trivial también deben validarse en el backend; las del
  cliente son solo para dar ayuda inmediata.

## Casos de prueba

| # | Tipo | Caso | Resultado esperado |
|---|---|---|---|
| 1 | unit | Schema: nombre, correo, PIN (longitud, dígitos, trivial, confirmación) | Acepta válidos, rechaza cada inválido con su mensaje |
| 2 | unit | Normalización de wallet (`$host/ruta`, `https://`, espacios, `http://`) | URL https normalizada; `http://` rechazado |
| 3 | component | `PinField`: solo dígitos, máximo 6, oculto, botón "ver" | Ignora letras; alterna visibilidad; accesible |
| 4 | integration | Enlace "Ya tengo cuenta" | Navega a ingresar |
| 5 | integration | Envío vacío | Errores por campo; MSW no recibe llamadas |
| 6 | integration | Verificación de wallet existente / inexistente | Muestra nombre y moneda / error del campo |
| 7 | integration | Registro exitoso | Una sola llamada a `POST /users` con el body esperado; sesión iniciada; navega al inicio |
| 8 | integration | `409 EMAIL_ALREADY_REGISTERED` | Error en el correo y enlace a ingresar |
| 9 | integration | Error de red | Mensaje de reintento; campos conservados; PIN vacío |
| 10 | integration | Doble toque en "Crear cuenta" | Una sola petición |

## Tareas

1. [ ] Handlers MSW de `POST /users` y `GET /wallets/verify` con el contrato.
2. [ ] Casos 1–2 en rojo → schema y normalización de wallet.
3. [ ] Caso 3 en rojo → `PinField`.
4. [ ] Casos 4–10 en rojo → pantalla de registro.
5. [ ] Proponer el contrato al backend (spec de usuarios) y registrar diferencias.
6. [ ] Suite completa en verde, lint y typecheck limpios.

## Decisiones pendientes

1. **Longitud del PIN:** recomendación 6 dígitos (4 es muy fácil de adivinar).
2. **Moneda de la wallet:** si la wallet no es COP ni USD, ¿se permite el registro? Recomendación: sí, se muestra con su código.

## Notas

- Depende de 010 y 012 (sesión). Por eso se desarrolla después del 012.
