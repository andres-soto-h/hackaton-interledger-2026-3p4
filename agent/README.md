# Agente de TuTranqui (spec 028)

Lambda en Python con [Strands Agents](https://strandsagents.com): LLM en Amazon Bedrock, tools que
llaman a la API de TuTranqui con el token del usuario y voz de ElevenLabs. Spec:
[backend 028](../backend/docs/specs/028-agente-voz.md).

| Archivo | Qué hace |
|---|---|
| `src/handler.py` | Entrada de la Lambda: arma el agente de Strands, lo ejecuta y agrega el audio |
| `src/tools.py` | `search_merchants`, `list_transactions`, `create_payment` (no hay tool de confirmar) |
| `src/api_client.py` | Cliente de la API con el token del usuario |
| `src/prompt.py` | Prompt del sistema |
| `src/voice.py` | Texto a voz con ElevenLabs (nunca bloquea el texto) |

La invoca la API (`POST /api/v1/agent/messages`) de forma síncrona; no tiene URL pública.

## Empaquetar y desplegar

```bash
./build.sh                 # genera agent/dist/package (Lambda arm64, Python 3.12, sin Docker)
cd ../backend && pnpm build
cd infra && pnpm exec cdk diff   # si agent/dist/package existe, el stack incluye el agente
```

`bin/app.ts` agrega el agente solo si existe `agent/dist/package`. Variables del despliegue:

| Variable | Por omisión |
|---|---|
| `AGENT_MODEL_ID` | `us.anthropic.claude-haiku-4-5-20251001-v1:0` (Claude Haiku; cambiarlo no toca el código) |
| `ELEVENLABS_VOICE_ID` | `JddqVF50ZSIR7SRbJE6u` |
| `ELEVENLABS_MODEL_ID` | `eleven_flash_v2_5` |
| `PUBLIC_API_URL` | Obligatoria: es la URL que usa el agente para llamar a la API |

Antes de usarlo en `dev`:
1. Habilitar el acceso al modelo en la consola de Bedrock (región `us-east-1`).
2. Cargar la llave: `aws secretsmanager put-secret-value --secret-id tranqui/dev/elevenlabs --secret-string '<llave>'`.

## Prueba local de las tools (sin Bedrock)

Las tools se pueden ejercitar contra una API falsa; requiere Python 3.10+ (por ejemplo `uv venv --python 3.12`
e instalar `strands-agents`).
