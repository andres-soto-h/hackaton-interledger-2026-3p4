# Plan inicial — API de pagos P2P / P2M

> Estado: **Aprobado** (2026-10-16) · Etapa actual: **planeación** (todavía no hay código)

App de transferencias P2P (persona a persona) y P2M (persona a comercio) sobre
[Open Payments](https://openpayments.dev) / Interledger. La primera fase es la API
(`backend/`) que soporta los pagos.

## Decisiones

| Tema | Decisión |
|---|---|
| Lenguaje | TypeScript |
| Runtime | Node.js (versión fijada en `.nvmrc`) |
| Framework HTTP | Express |
| Tests | Vitest + supertest |
| Gestor de paquetes | pnpm |
| Despliegue | AWS Lambda (ver spec de infraestructura) |
| Documentación | `backend/docs/` (cada carpeta del repo tiene su propia documentación) |
| Metodología | SDD (Spec-Driven Development) + TDD |

## Estructura del backend

```
backend/
├── package.json
├── tsconfig.json
├── .env.example              ← variables documentadas, sin valores secretos
├── .nvmrc
├── eslint.config.js
├── .prettierrc
├── vitest.config.ts
├── README.md                 ← cómo correr, probar y configurar
├── keys/                     ← llaves privadas para desarrollo local
├── reference/
│   └── p2p-payment-example.js   ← ejemplo original, solo como referencia
├── src/
│   ├── server.ts             ← arranque local (listen)
│   ├── lambda.ts             ← handler de AWS Lambda que envuelve la app
│   ├── app.ts                ← arma Express sin listen (testeable)
│   ├── config/
│   │   └── env.ts            ← lee y valida variables; falla al arrancar si falta alguna
│   ├── modules/              ← un módulo por funcionalidad
│   │   ├── auth/             ← grants interactivos y callback de Open Payments
│   │   ├── payments/         ← hacer un pago (quote + outgoing payment)
│   │   ├── payment-requests/ ← solicitar un pago (incoming payment)
│   │   └── transactions/     ← consultar transacciones
│   │       (cada módulo: *.routes.ts, *.controller.ts, *.service.ts, *.schemas.ts)
│   ├── integrations/
│   │   └── open-payments/    ← único lugar que conoce el SDK de Interledger
│   │       ├── client.ts
│   │       └── grants.ts
│   └── shared/
│       ├── errors/           ← AppError + middleware de errores centralizado
│       ├── middlewares/      ← validación de requests, 404
│       └── logger.ts
└── tests/
    ├── unit/                 ← services y helpers con el SDK mockeado
    ├── integration/          ← endpoints HTTP con supertest
    └── fixtures/             ← respuestas de ejemplo de Open Payments
```

### Principios

- **Capas por módulo:** routes → controller → service → integración. El controller
  solo traduce HTTP; el service tiene la lógica; solo `integrations/open-payments`
  habla con Interledger. Los services se prueban con mocks, sin red.
- **`app.ts` separado de `server.ts` y `lambda.ts`:** la misma app corre en local,
  en Lambda y en los tests.
- **Sin secretos en código:** key ID, wallets y llaves privadas vienen de
  configuración (`.env` en local, servicio de secretos en AWS).
- **Estado de grants detrás de una interfaz (repositorio):** implementación en
  memoria para local/tests y persistente para Lambda, porque Lambda no conserva
  memoria entre invocaciones.

## Endpoints

| Módulo | Endpoint | Qué hace |
|---|---|---|
| payment-requests | `POST /api/v1/payment-requests` | Crea un incoming payment (solicitar pago) |
| payments | `POST /api/v1/payments` | Crea el quote e inicia el grant; devuelve la URL de aprobación |
| auth | `GET /api/v1/auth/callback` | Recibe `interact_ref`, continúa el grant y ejecuta el outgoing payment |
| transactions | `GET /api/v1/transactions` | Lista pagos entrantes y salientes de una wallet |
| — | `GET /health` | Verifica que la API esté arriba |

- Los grants no interactivos (incoming payment, quote) son internos de la capa de
  integración; el grant interactivo de outgoing payment es el flujo de `auth`.
- P2P y P2M comparten flujo; se distinguen con un campo `type: "p2p" | "p2m"`.

## Flujo de trabajo (SDD + TDD)

```
backend/docs/
├── PLAN.md          ← este documento
├── KANBAN.md        ← tablero de avance de specs
└── specs/
    ├── _TEMPLATE.md
    └── NNN-<nombre>.md
```

1. Claude redacta el spec → **Borrador**. El responsable lo aprueba → **Aprobado**.
2. El desarrollo solo inicia con autorización explícita → **En desarrollo**.
3. TDD: tests primero (rojo) → código mínimo (verde) → refactor.
4. Pasa a **Hecho** solo con toda la suite en verde. No se inicia otro spec antes.
5. Cada cambio de estado actualiza `KANBAN.md` y la sección *Estado* del spec.

Los specs se numeran en orden de creación (`001`, `002`, …).

## Fuera de alcance por ahora

Problemas detectados en el ejemplo original (`backend/src/api/index.js`), que no se
corrigen; el ejemplo queda solo como referencia y el servicio nuevo se construye
desde cero con estas prácticas:

- Dependencia `"@interledger/open-payments": "workspace:^"` (solo funciona dentro del monorepo de Interledger).
- `package.json` dentro de `src/`.
- `readline` como dependencia (es un módulo nativo de Node).
