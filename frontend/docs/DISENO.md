# Sistema de diseño — TuTranqui

Referencia común para los specs del frontend. Tomado de los mockups
([PLAN.md](PLAN.md)); se implementa como tokens en `src/theme/` y
componentes en `src/ui/` (spec [010](specs/010-bootstrap-frontend.md)).

## Público y tono

- Pensado para personas que no son expertas en tecnología (la persona del
  mockup es "doña Claudia"): frases cortas, trato de **usted**, sin jerga
  ("dirección de pago" en vez de "wallet address" en los textos de ayuda;
  el campo del registro sí dice "Dirección de su wallet").
- Cada paso dice qué va a pasar y que **nada se mueve sin su sí**.
- Los montos se escriben con números y, en la confirmación, también en
  palabras para el lector de pantalla y la voz ("ochenta y seis mil
  cuatrocientos pesos").

## Colores

| Token | Valor | Uso |
|---|---|---|
| `primary` | `#0B3364` | Botón principal, encabezados, enlaces, íconos |
| `accent` | `#F7844B` | Llamado de la bienvenida, micrófono activo, avatar |
| `success` | `#2E6B45` | Pago exitoso, validaciones correctas |
| `danger` | `#9A3D12` | Errores y rechazos |
| `text` | `#111111` | Texto principal |
| `textMuted` | `#4A5170` | Texto secundario y etiquetas |
| `surface` | `#FFFFFF` | Tarjetas |
| `surfaceAlt` | `#E6E9F2` | Tarjetas de detalle, chips, filas de montos |
| `background` | `#FBF8F2` | Fondo de las pantallas |
| `border` | `#E0E0E0` | Bordes y separadores |

Contraste mínimo AA (4,5:1) para texto. `accent` no se usa como color de texto
sobre blanco (no llega a AA); solo como fondo con texto `text` o `primary`.

## Tipografía

| Token | Fuente | Tamaño | Uso |
|---|---|---|---|
| `title` | Lexend 600 | 22 px | Título de la pantalla, mensaje principal |
| `heading` | Lexend 600 | 18–20 px | Títulos de tarjetas, montos destacados |
| `body` | Atkinson Hyperlegible 400 | 17 px | Texto general |
| `bodyStrong` | Atkinson Hyperlegible 700 | 17 px | Valores en filas de montos |
| `label` | Atkinson Hyperlegible 400 | 15 px | Etiquetas y ayudas |
| `caption` | Atkinson Hyperlegible 400 | 13 px | Pasos ("Paso 2 de 2"), notas |

Ambas fuentes son de Google Fonts (licencia OFL) y se cargan con
`expo-font` / `@expo-google-fonts/*`. El texto respeta el tamaño de fuente del
sistema (`allowFontScaling`), con un tope para no romper el diseño.

## Espacios y formas

- Escala de espacios: 4, 8, 12, 16, 20, 24, 32.
- Margen lateral de pantalla: 20 px. Ancho máximo del contenido en web: 480 px,
  centrado (la app se ve como un teléfono en pantallas grandes).
- Radios: tarjetas 16 px, botones 14 px, chips 22 px, burbujas del chat
  `4 18 18 18`.
- Botones: alto mínimo 52 px (principal) y 48 px (secundario); área táctil
  mínima de 48 × 48.

## Componentes base (`src/ui/`)

| Componente | Descripción | Mockup |
|---|---|---|
| `Screen` | Fondo, márgenes, scroll, ancho máximo en web, área segura | todas |
| `AppHeader` | Logo "TuTranqui" + acción a la derecha ("Mi cuenta", "Parar", "Cancelar") | todas |
| `StepIndicator` | "Paso N de M · Nombre" | 1.6, 1.7 |
| `Button` | Variantes `primary`, `secondary`, `ghost`, `danger`; estado `loading`; ícono opcional | todas |
| `TextField` | Etiqueta visible, ayuda, error, `accessibilityLabel` | registro, login |
| `PinField` | PIN de 6 dígitos con teclado numérico, oculto, botón "ver" | registro, login |
| `Card` | Superficie con radio 16 | todas |
| `AmountRow` | Etiqueta, detalle opcional y valor alineado a la derecha | 1.7, 1.8 |
| `CheckItem` | Ítem de validación (✓ verde, pendiente o error) con título y detalle | 1.6, 2.2 |
| `StatusBadge` | Estado de un pago con color e ícono (no solo color) | lista, resultado |
| `AgentBubble` / `UserBubble` | Burbujas del chat ("TuTranqui dice" / "Usted dijo") | 3.3 – 3.6 |
| `MicButton` | Botón grande de voz con estado escuchando | 1.5, 3.2 |
| `MerchantTile` | Comercio del directorio: logo, nombre, categoría, nota ("vence el 24") | 1.5, 2.1 |
| `EmptyState` / `ErrorState` | Mensaje, acción para reintentar | — |

## Estados de un pago en la UI

| Estado de la API | Texto | Color |
|---|---|---|
| `PENDING_AUTHORIZATION` | Esperando su aprobación | `textMuted` |
| `PROCESSING` | Enviando el pago… | `primary` |
| `COMPLETED` | Pago exitoso | `success` |
| `FAILED` | El pago no se pudo hacer | `danger` |
| `REJECTED` | Usted no aprobó el pago | `danger` |
| `EXPIRED` | Se venció el tiempo para aprobar | `textMuted` |

## Accesibilidad

- Todo control tiene `accessibilityRole` y `accessibilityLabel`; los tests de
  componentes los buscan por rol y nombre (`getByRole`), lo que de paso
  verifica la accesibilidad.
- El estado no se comunica solo con color: siempre hay texto o ícono.
- Los cambios de estado importantes (resultado del pago, respuesta del agente)
  se anuncian al lector de pantalla (`accessibilityLiveRegion` /
  `AccessibilityInfo.announceForAccessibility`).
