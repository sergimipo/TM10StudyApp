# Estudia con IA (Next.js)

Pega un tema y practica con preguntas tipo test, verdadero/falso, respuesta corta y respuesta abierta.
La IA genera las preguntas y corrige las respuestas, y siempre te muestra la solución.

## Puesta en marcha

```bash
npm install
cp .env.example .env.local     # y pon tu GOOGLE_API_KEY
npm run dev
```

Abre http://localhost:3000

Consigue tu clave de Google (Gemini) en https://aistudio.google.com/apikey

## Estructura

```
app/
  page.tsx               Interfaz completa (configuración, cuestionario, resultados)
  layout.tsx, globals.css
  api/generate/route.ts  Genera las preguntas
  api/grade/route.ts     Corrige respuestas cortas y abiertas
lib/
  ai.ts                  Llamada a la API de Google Gemini (solo servidor)
  validate.ts            Valida y baraja las preguntas
  types.ts               Tipos y constantes compartidas
```

## Variables de entorno

| Variable | Para qué | Por defecto |
|---|---|---|
| `GOOGLE_API_KEY` | Tu clave de Google (obligatoria) | — |
| `GOOGLE_MODEL` | Modelo que genera preguntas | `gemini-2.5-flash` |
| `GOOGLE_GRADE_MODEL` | Modelo que corrige | `gemini-2.5-flash` |

Si Google retira o renombra un modelo, cambia el nombre aquí sin tocar el código.

## Desplegar en Vercel

Sube el proyecto a GitHub, impórtalo en Vercel y añade `GOOGLE_API_KEY` en Settings > Environment Variables.

Ojo: si lo despliegas público, cualquiera que abra la web gasta TU cuota de API. Antes de compartir el enlace
añade algún tipo de protección (contraseña, login o límite de peticiones por IP).

## Ideas para ampliar

- Guardar historial de notas (localStorage o una base de datos)
- Repetir solo las preguntas falladas
- Subir PDF y extraer el texto
- Temporizador / modo examen
