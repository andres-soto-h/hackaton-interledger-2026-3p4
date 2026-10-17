# 009 — Agente por voz

| Campo | Valor |
|---|---|
| Estado | **Borrador** · *pendiente de definición técnica* |
| Creado | 2026-10-16 |
| Spec aprobado | — |
| Desarrollo aprobado | — |
| Finalizado | — |

## Estado

0 / 3 tareas completadas. **Pendiente de definición:** la voz se integra con el
SDK de agentes de Gemini y el texto a voz (TTS) se hace con modelos de Google
Cloud. Este spec fija lo que el usuario debe poder hacer; el diseño técnico se
escribe cuando se defina la integración (tarea 1) y entonces el spec queda
listo para aprobación.

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

*Pendiente de definición.* Lo que se sabe:

- **Agente y voz:** SDK de agentes de Gemini. Se espera que tenga componentes o
  hooks propios para React; hay que confirmar si funcionan en React Native
  (web y Android) o solo en React web.
- **Texto a voz:** modelos de TTS de Google Cloud.
- **Se mantiene del plan:** las credenciales de Google Cloud nunca van en la
  app (todo lo que va en el bundle es público); si el SDK necesita conectarse
  directo desde el cliente, se usa un token de corta vida emitido por el
  backend. Ni la voz ni el agente pueden confirmar pagos.
- **Se mantiene para los tests:** la voz se usa detrás de una interfaz propia
  (entrada y salida de voz) para que los tests usen fakes, sin micrófono ni
  audio.

Preguntas que debe responder la definición:

1. ¿El SDK soporta React Native/Expo, o hay que usar su versión web en web y
   otra vía en Android?
2. ¿El reconocimiento de voz lo hace Gemini (audio al servicio) o el
   dispositivo (texto al agente)?
3. ¿El audio del TTS llega por streaming desde el servicio o lo genera el
   backend?
4. ¿Cómo encaja con el contrato del chat (spec 008): la voz usa el mismo
   endpoint del agente o una sesión de audio aparte?
5. ¿Qué permisos y builds necesita Android (micrófono, *development build*)?

## Casos de prueba

Se definen con el diseño. Los criterios de aceptación de arriba son la base.

## Tareas

1. [ ] Definir la integración con el SDK de agentes de Gemini y el TTS de Google Cloud (responder las preguntas del diseño) y completar diseño, casos de prueba y tareas de este spec.
2. [ ] Ajustar el spec 008 si la definición cambia el contrato del chat.
3. [ ] Pasar el spec a revisión para aprobación.

## Decisiones pendientes

1. **Integración de voz:** SDK de agentes de Gemini + TTS de Google Cloud
   (por definir, ver [Diseño](#diseño)).
2. **Escuchar las respuestas por defecto:** recomendación sí cuando la
   conversación empezó por voz; no cuando empezó por texto.
