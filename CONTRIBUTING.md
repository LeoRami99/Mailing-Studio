# Cómo contribuir a Misiva

¡Gracias por querer mejorar Misiva! Toda ayuda suma: reportes de errores, pruebas en clientes de correo,
traducciones, documentación y código.

## Antes de empezar

- Busque en los *issues* si alguien ya reportó el problema o propuso la idea.
- Para cambios grandes (un bloque nuevo, otra plataforma de envío, cambios en el modelo de datos),
  abra primero un *issue* para acordar el enfoque.
- Al participar acepta el [Código de conducta](CODE_OF_CONDUCT.md).

## Entorno de desarrollo

Requisitos: Node.js 20.9 o superior (recomendado 22 LTS) y npm.

```bash
git clone <url-del-repositorio> misiva
cd misiva
npm install
npm run dev            # versión web en http://localhost:3000
npm run electron:dev   # versión de escritorio
```

Antes de enviar un *pull request*:

```bash
npm run lint
npx tsc --noEmit
npm run build
```

## Guía rápida del código

| Quiere…                                   | Toque…                                                        |
| ----------------------------------------- | ------------------------------------------------------------- |
| Cambiar el HTML que se exporta            | `lib/email/render.ts`                                         |
| Agregar un tipo de bloque                 | `lib/email/types.ts`, `defaults.ts`, `render.ts`, `components/editor/Inspector.tsx` |
| Agregar una plataforma de envío           | `lib/email/platforms.ts` (y `normalizeMergeTags` en `components/editor/Modals.tsx` para importar) |
| Agregar una regla de revisión             | `lib/email/validate.ts`                                       |
| Cambiar la app de escritorio              | `electron/main.cjs`, `scripts/`                               |

Este proyecto usa **Next.js 16**, con cambios importantes respecto a versiones anteriores. Consulte la
documentación incluida en `node_modules/next/dist/docs/` antes de usar APIs de Next.

### Reglas para el HTML de correo

El HTML exportado debe funcionar en Outlook de escritorio (motor de Word), Gmail y Apple Mail:

- Maquetación con `<table role="presentation">`, nunca `flex`, `grid`, `float` ni `position`.
- Estilos en línea; el `<style>` del `<head>` solo para media queries y modo oscuro.
- Imágenes con `width`, `alt` y URL absoluta.
- Si agrega sintaxis de una plataforma, enlace su documentación oficial en `platforms.ts`.

Si su cambio afecta el HTML exportado, pruébelo con un envío real (o con Litmus / Email on Acid) e
indique en el PR en qué clientes lo verificó.

## Estilo

- TypeScript estricto, componentes de React con *hooks*.
- La interfaz está en español; use textos claros y en segunda persona formal («Suba una imagen»).
- Mensajes de commit breves y en imperativo: `Agrega bloque de video`, `Corrige botón en Outlook 2016`.

## Publicar una versión (mantenedores)

1. Actualice `version` en `package.json` y `CHANGELOG.md`.
2. Cree y suba la etiqueta: `git tag v0.2.0 && git push origin v0.2.0`.
3. El flujo **Release** de GitHub Actions compila los instaladores de Linux, Windows y macOS y los
   adjunta a un borrador de *release*. Revíselo y publíquelo.
