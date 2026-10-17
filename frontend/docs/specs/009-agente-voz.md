# 009 — Agente por voz

| Campo | Valor |
|---|---|
| Estado | **En desarrollo** |
| Creado | 2026-10-16 |
| Spec aprobado | 2026-10-16 |
| Desarrollo aprobado | 2026-10-17 |
| Finalizado | — |

## Estado

7 / 9 tareas completadas (typecheck, lint y export web en verde; **sin ejecutar tests** por la directiva vigente). Desarrollo aprobado el 2026-10-17 con el ajuste del [backend 028](../../../backend/docs/specs/028-agente-voz.md): voz a texto en el dispositivo (Web Speech API) y respuestas con el audio de ElevenLabs que manda el backend. Faltan la verificación manual (tarea 8) y escribir las pruebas (tarea 9), diferidas.

## Contexto

Muchas personas prefieren hablar que escribir (mockups 3.1 – 3.2: "Toque y
dígame qué pagar", "Le estoy escuchando"). Este spec agrega voz a la
conversación del spec 008: el usuario le habla al agente y la respuesta del
agente se escucha en voz alta. La voz **no aprueba pagos**: decir "sí" puede
llevar a la confirmación, pero el pago solo se confirma con el passkey en la app
([PLAN.md](../PLAN.md#seguridad)).

## Alcance

**Incluye**
- `MicButton` en el inicio y en el chat; estado "Le estoy escuchando" con la transcripción.
- "Ya terminé de hablar" y "Cancelar"; fin automático tras un silencio.
- Mostrar "Usted dijo: «…»" en la conversación.
- Respuestas del agente y resumen de la confirmación (006) en voz alta, con opción de silenciar.
- Permiso de micrófono: pedirlo, explicar para qué y manejar el rechazo.
- Respaldo a texto cuando la voz no está disponible.

**No incluye**
- Palabra de activación ("Oye TuTranqui").
- Confirmar pagos por voz.

## Criterios de aceptación

- **Dado** el permiso de micrófono concedido, **cuando** toca el micrófono, **entonces** ve "Le estoy escuchando" y la transcripción de lo que dice.
- **Dado** que termina de hablar (botón o silencio), **cuando** hay texto, **entonces** ve "Usted dijo: «…»" y el agente recibe el mensaje.
- **Dado** que no se entendió nada, **cuando** termina, **entonces** ve "No le escuché bien. ¿Lo repite?" y no se envía nada.
- **Dado** el permiso negado, **cuando** toca el micrófono, **entonces** ve cómo activarlo y puede escribir en su lugar.
- **Dado** que la voz no está disponible (navegador o dispositivo sin soporte, sin conexión con el servicio), **cuando** abre el chat, **entonces** el micrófono no aparece y se usa solo texto.
- **Dado** una respuesta del agente, **cuando** llega y la voz está activa, **entonces** se escucha en español; si el usuario empieza a hablar o toca "Parar", se detiene.
- **Dado** que el agente propone un pago y el usuario dice "sí", **cuando** el agente responde, **entonces** como máximo se navega a la confirmación (006); el pago solo se confirma con el passkey.
- **Dado** "Repítamelo" en la confirmación, **cuando** lo toca, **entonces** se vuelve a escuchar el resumen del pago.

## Diseño

> **Propuesta del 2026-10-17, pendiente de aprobación del responsable.** No se escribe código
> hasta que se apruebe y se autorice el desarrollo.

### Recomendación: voz en el dispositivo, mismo contrato del chat

La voz no cambia el contrato del agente: se transcribe en el dispositivo y el texto va por el
mismo `POST /agent/messages` del spec 008 con `inputMode: "voice"`. La respuesta del agente se
lee con texto a voz. Así el SDK de Gemini queda del lado del backend (donde viven las
credenciales) y la app no depende de que ese SDK soporte React Native.

| Pieza | Recomendación | Alternativa |
|---|---|---|
| Voz a texto | **Web Speech API** (`SpeechRecognition`) en Chrome, web y Android-en-Chrome, idioma `es-CO` con respaldo `es-US`/`es-ES`. En app nativa, `expo-speech-recognition` (misma interfaz) cuando se salga de Chrome (TD-003) | Enviar el audio a Gemini (cambia el contrato y sube el costo) |
| Texto a voz | **`SpeechSynthesis`** del navegador (`expo-speech` en nativo) con voz en español: sin backend ni credenciales | **Google Cloud TTS (Chirp 3 HD, `es-US`)** vía un endpoint del backend que devuelve el audio: mejor calidad, pero necesita backend y costo |
| Agente | El del backend (SDK de agentes de Gemini), sin cambios para la app | Gemini Live API con *ephemeral tokens* emitidos por el backend: la app habla directo por WebSocket; es *preview*, cambia el chat y la seguridad |

Por qué: es lo mínimo que cumple los criterios de aceptación en el plazo del hackatón, no expone
credenciales y se puede mejorar después (cambiar el TTS por Chirp 3 HD no toca las pantallas).

### Respuestas a las preguntas de la definición

1. **¿El SDK soporta React Native?** No hace falta saberlo: el SDK corre en el backend; la app solo usa texto y audio del dispositivo.
2. **¿Quién reconoce la voz?** El dispositivo/navegador (texto al agente).
3. **¿Cómo llega el audio del TTS?** Lo genera el dispositivo; si se pasa a Chirp 3 HD, lo genera el backend y la app lo reproduce.
4. **¿Mismo endpoint?** Sí, `POST /agent/messages` con `inputMode: "voice"`.
5. **Permisos en Android:** en Chrome, el permiso de micrófono del sitio (HTTPS); en app nativa harían falta el permiso de micrófono y un *development build*.

### Interfaces (para poder probar con fakes)

```ts
interface SpeechInput {
  isAvailable(): Promise<boolean>
  requestPermission(): Promise<"granted" | "denied">
  start(onPartial: (text: string) => void): Promise<void>   // transcripción en vivo
  stop(): Promise<string>                                    // texto final ("" si no entendió)
  cancel(): void
}
interface SpeechOutput {
  isAvailable(): boolean
  speak(text: string): Promise<void>
  stop(): void
}
```

- Hooks: `useVoiceInput()` (estados `idle | listening | processing | denied | unavailable`),
  `useSpokenReplies()` (silenciar/activar; por omisión activo solo si la conversación empezó por voz).
- Fin automático por silencio lo da el reconocimiento (`continuous: false`) o un temporizador de ~3 s sin texto nuevo.
- Antes de hablar, `SpeechOutput.stop()`; si la persona empieza a hablar o toca "Parar", se corta la voz.
- `MicButton`: en el inicio abre el chat y empieza a escuchar; en el chat está junto al campo de texto. Oculto si `isAvailable()` es falso.
- La confirmación (006) reutiliza `buildSpokenSummary` para "Repítamelo" y la lectura al entrar.
- **Seguridad:** el texto transcrito se trata igual que el escrito (sin interpretar). Decir "sí" solo
  puede llevar a la pantalla de confirmación; confirmar sigue exigiendo el passkey (backend 007).

## Casos de prueba

| # | Tipo | Caso | Resultado esperado |
|---|---|---|---|
| 1 | unit | `useVoiceInput` con fake: permiso concedido, escucha, texto final | `listening` con transcripción parcial → `processing` → envía el texto con `inputMode: "voice"` |
| 2 | unit | Fin por silencio con reloj falso | Termina a los ~3 s sin texto nuevo |
| 3 | unit | Transcripción vacía | "No le escuché bien. ¿Lo repite?" y no se envía |
| 4 | unit | Permiso negado / sin soporte | `denied` con instrucciones / `unavailable` |
| 5 | component | `MicButton` por estado | Etiqueta accesible ("Hablar", "Le estoy escuchando", "Ya terminé de hablar") |
| 6 | integration | Chat: hablar → "Usted dijo: «…»" → respuesta | `POST /agent/messages` con `inputMode: "voice"`; la respuesta se lee |
| 7 | integration | Voz no disponible | No aparece el micrófono; el chat funciona con texto |
| 8 | integration | Respuesta en voz y "Parar" / empezar a hablar | `SpeechOutput.stop()` |
| 9 | integration | Decir "sí" con un pago propuesto | Como máximo navega a la confirmación; sin `POST /confirm` |
| 10 | integration | "Repítamelo" en la confirmación | `speak` con el resumen del pago |
| 11 | manual | Chrome de escritorio y Chrome en Android, voz en `es-CO` | Transcribe y lee en español |

## Tareas

1. [x] Definir la integración (esta propuesta) y completar diseño, casos de prueba y tareas.
2. [x] Spec 008: agregar `inputMode: "voice"` al hook de envío y al contrato (ya está en el contrato; verificar el reducer).
3. [x] Aprobación de este diseño por el responsable (y autorización del desarrollo).
4. [x] Interfaces `SpeechInput` / `SpeechOutput` y adaptadores web en `src/features/voice/` (los fakes y casos 1–4 quedan para cuando se reactiven las pruebas).
5. [x] `MicButton`, estados (escuchando, permiso negado, no se entendió, sin soporte) y permisos.
6. [x] Integración con el chat: `speak: true` al hablar, reproducción de `reply.audio`, respaldo con la voz del navegador, "Silenciar respuestas" y "Escuchar"; el micrófono del inicio **ya no abre otra pantalla**: despliega un panel inferior (`AssistantSheet`) sobre el inicio, con un orbe animado de escucha (ondas y barras de voz, respeta "reducir movimiento"), la transcripción en vivo, la conversación y la caja de texto. "Prefiero escribir" abre el mismo panel sin escuchar. La conversación vive en `AgentProvider`, así que cerrar el panel no la pierde; `/agente` sigue como pantalla completa.
7. [x] "Repítamelo" lee el resumen en voz alta en la confirmación (voz del dispositivo).
8. [ ] Verificación manual en Chrome y Chrome en Android (caso 11), con el backend 028 desplegado.
9. [ ] Escribir y ejecutar las pruebas 1–10 y dejar la suite en verde. *(Diferida: directiva de no tests.)*

## Referencias

- [Gemini Live API: ephemeral tokens](https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens) (preview).
- [Cloud Text-to-Speech: Chirp 3 HD](https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd) (español `es-US` y `es-ES`).
- [Agent Development Kit](https://docs.cloud.google.com/agent-builder/agent-development-kit/overview).
- [expo-speech-recognition](https://github.com/jamsch/expo-speech-recognition) (Web Speech API en web).
- Sin verificar: que `es-CO` funcione en Chrome de Android; se confirma en la prueba manual (caso 11).

## Decisiones pendientes

1. **Aprobar el diseño propuesto** (STT en el dispositivo + TTS del navegador, con Chirp 3 HD como mejora futura) o elegir la alternativa de Gemini Live.
2. **Escuchar las respuestas por defecto:** recomendación sí cuando la
   conversación empezó por voz; no cuando empezó por texto.

## Ajuste por backend 028 (2026-10-17)

El responsable aprobó el [backend 028](../../../backend/docs/specs/028-agente-voz.md): el agente corre en el
backend (Strands + Bedrock) y la voz la genera **ElevenLabs**. Esto cambia la propuesta de este spec:

- **Texto a voz:** la app pide el audio con `speak: true` en `POST /agent/messages` y lo reproduce desde
  `reply.audio` (mp3 en base64). `SpeechSynthesis` del navegador queda como **respaldo** cuando llega
  `reply.audioUnavailable: true` o no hay audio.
- **Voz a texto:** sin cambios; sigue en el dispositivo y se envía como texto con `inputMode: "voice"`.
- **Contrato:** la respuesta suma `reply.audio` y `reply.audioUnavailable` (el frontend 008 también se ajusta).
- La decisión 1 de arriba (TTS del navegador frente a Chirp 3 HD) queda sustituida por ElevenLabs vía backend.
- Sigue sin confirmar pagos por voz: solo el passkey confirma.

