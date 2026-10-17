# 009 — Agente por voz

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

Muchas personas prefieren hablar que escribir (mockups 3.1 – 3.2: "Toque y
dígame qué pagar", "Le estoy escuchando"). Este spec agrega voz a la
conversación del spec 008: lo que el usuario dice se convierte en texto y se
envía al agente, y la respuesta del agente se lee en voz alta. La voz **no
aprueba pagos**: decir "sí" puede llevar a la confirmación, pero la aprobación
sigue siendo en la wallet ([PLAN.md](../PLAN.md#seguridad)).

## Alcance

**Incluye**
- `MicButton` en el inicio y en el chat; pantalla/estado "Le estoy escuchando" con la transcripción en vivo.
- Voz a texto con `expo-speech-recognition` (Web Speech API en web; reconocedor del sistema en Android), idioma `es-CO`.
- "Ya terminé de hablar" y "Cancelar"; fin automático tras un silencio.
- Mostrar "Usted dijo: «…»" antes de enviar y enviarlo al agente con `inputMode: "voice"`.
- Texto a voz con `expo-speech` para las respuestas del agente y el resumen de la confirmación (006), con opción de silenciar.
- Permiso de micrófono: pedirlo, explicar para qué y manejar el rechazo.
- Respaldo a texto cuando el dispositivo o navegador no soporta reconocimiento de voz.

**No incluye**
- Voz grabada enviada al servidor (todo el reconocimiento es en el dispositivo o navegador).
- Palabra de activación ("Oye TuTranqui").
- Aprobar pagos por voz.

## Criterios de aceptación

- **Dado** el permiso de micrófono concedido, **cuando** toca el micrófono, **entonces** ve "Le estoy escuchando" y la transcripción a medida que habla.
- **Dado** que termina de hablar (botón o silencio de 2 s), **cuando** hay texto, **entonces** ve "Usted dijo: «…»" y se envía al agente como mensaje de voz.
- **Dado** que el reconocimiento no entendió nada, **cuando** termina, **entonces** ve "No le escuché bien. ¿Lo repite?" y no se envía nada.
- **Dado** el permiso negado, **cuando** toca el micrófono, **entonces** ve cómo activarlo y puede escribir en su lugar.
- **Dado** un navegador sin reconocimiento de voz, **cuando** abre el chat, **entonces** el micrófono no aparece y se usa solo texto.
- **Dado** una respuesta del agente, **cuando** llega y la voz está activa, **entonces** se lee en voz alta en español; si el usuario empieza a hablar o toca "Parar", la lectura se detiene.
- **Dado** que el agente propone un pago y el usuario dice "sí", **cuando** el agente responde, **entonces** como máximo se navega a la confirmación (006); el pago solo se aprueba en la wallet.
- **Dado** "Repítamelo" en la confirmación, **cuando** lo toca, **entonces** se vuelve a leer el resumen del pago.

## Diseño

### Abstracción

```ts
interface SpeechInput  { isAvailable(): Promise<boolean>; requestPermission(): Promise<"granted" | "denied">;
                         start(opts: { lang: "es-CO", onPartial, onFinal, onError }): void; stop(): void; abort(): void }
interface SpeechOutput { speak(text: string, opts: { lang: "es-CO" }): void; stop(): void; isSpeaking(): boolean }
```

- Implementaciones reales en `src/features/voice/` sobre `expo-speech-recognition`
  y `expo-speech`; en los tests se inyectan fakes (sin micrófono ni audio).
- `useVoiceInput()` maneja los estados `idle → requesting → listening →
  processing → idle | error`.
- La lectura en voz alta usa el texto de la respuesta (`reply.text`), sin
  markdown, y en la confirmación usa `toSpokenAmount` (spec 001).

### Plataformas

| | Web | Android |
|---|---|---|
| Voz a texto | Web Speech API (Chrome, Edge; Safari parcial; Firefox no) | Reconocedor del sistema; requiere *development build* (no Expo Go) |
| Texto a voz | `speechSynthesis` | TTS del sistema |
| Permiso | Pedido por el navegador; requiere HTTPS | Permiso `RECORD_AUDIO` en `app.json` |

## Casos de prueba

| # | Tipo | Caso | Resultado esperado |
|---|---|---|---|
| 1 | unit | `useVoiceInput` con fake: parcial → final; vacío; error; cancelar | Estados y texto correctos; vacío no envía |
| 2 | unit | `useVoiceInput`: permiso negado; no disponible | Estado `error` con motivo; `isAvailable` falso oculta el micrófono |
| 3 | component | `MicButton`: estados, etiqueta accesible ("Hablar", "Dejar de escuchar") | Rol botón; etiqueta según estado |
| 4 | integration | Chat por voz: hablar → "Usted dijo" → `POST /agent/messages` con `inputMode: "voice"` | Mensaje enviado y respuesta leída por el fake de salida |
| 5 | integration | El usuario habla mientras se lee una respuesta / toca "Parar" | `SpeechOutput.stop()` |
| 6 | integration | Voz silenciada | No llama a `speak` |
| 7 | integration | "Sí" por voz ante un pago propuesto | Como máximo navega a la confirmación; no llama a `openAuthorization` |
| 8 | manual | Chrome de escritorio y Android físico: pagar la luz por voz de principio a fin | Flujo completo con aprobación en la wallet |

## Tareas

1. [ ] Interfaces `SpeechInput`/`SpeechOutput` y fakes para tests.
2. [ ] Casos 1–2 en rojo → `useVoiceInput`.
3. [ ] Caso 3 en rojo → `MicButton`.
4. [ ] Casos 4–7 en rojo → voz en el chat, en el inicio y "Repítamelo" en la confirmación.
5. [ ] Implementaciones reales, permiso en `app.json`, *development build* de Android y verificación manual (caso 8).
6. [ ] Suite completa en verde, lint y typecheck limpios.

## Decisiones pendientes

1. **Navegadores sin voz** (Firefox, Safari parcial): recomendación ocultar el
   micrófono y seguir solo con texto, en vez de enviar audio a un servicio de
   transcripción.
2. **Leer en voz alta por defecto:** recomendación sí cuando la conversación
   empezó por voz; no cuando empezó por texto.
