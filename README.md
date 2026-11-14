# Bioclean Green Cozumel · Entregas

Web app para registrar las entregas de los choferes y consultarlas desde la oficina.

- **Choferes (teléfono):** botón **+ Nueva entrega** → asistente paso a paso: cliente, vehículo, facturas (número y foto de cada una; botón **Agregar otra factura** si el cliente pide varias), foto de quien recibe, foto de la mercancía, ubicación, estatus, pago (**Pagado** o **Crédito**) y anotaciones (obligatorias si el estatus no es "Entrega exitosa"). En el paso de ubicación se muestra la ubicación guardada del cliente: el chofer toca **Continuar con esta ubicación** o **Modificar ubicación para esta entrega** (toma el GPS; solo cambia esa entrega, no la ubicación guardada del cliente). Ven sus entregas del día. Si se cierra el navegador o se va la señal, el avance (fotos incluidas) se guarda en el teléfono y pueden continuar.
- **Administrador (computadora):** tabla de entregas con filtros por fecha, chofer, cliente/factura y estatus; exportación a Excel (CSV); detalle de cada entrega con fotos y mapa; **Descargar PDF** del comprobante para adjuntarlo a un correo. Filtro por pago (pagado/crédito). Pestañas para ver choferes, renombrar/fusionar clientes duplicados (y quitar la ubicación guardada de un cliente que se mudó) y agregar, renombrar o eliminar **Vehículos**. En **Clientes → Recordatorios…** se configuran los avisos de pago por correo o WhatsApp de las entregas a crédito, y en el detalle de una entrega a crédito está el botón **Marcar como pagado** (ver [Recordatorios de pago](#recordatorios-de-pago)).

Stack: Vite + React + TypeScript, CSS Modules, Convex (base de datos, fotos y login con Google vía Convex Auth).

## Configuración inicial

Requiere Node.js 20 o más reciente.

1. **Instalar dependencias**

   ```sh
   npm install
   ```

2. **Crear el proyecto en Convex** (abre el navegador para iniciar sesión en Convex y crea `.env.local`):

   ```sh
   npx convex dev
   ```

   Déjalo corriendo en una terminal.

3. **Configurar Convex Auth** (genera las llaves `JWT_PRIVATE_KEY`, `JWKS` y `SITE_URL`):

   ```sh
   npx @convex-dev/auth
   ```

4. **Crear las credenciales de Google** en [Google Cloud Console](https://console.cloud.google.com/apis/credentials):
   - *Create credentials → OAuth client ID → Web application*.
   - *Authorized JavaScript origins*: `http://localhost:5173` y, después, la URL donde publiques la app.
   - *Authorized redirect URIs*: `https://<tu-deployment>.convex.site/api/auth/callback/google`
     (el nombre del deployment está en `.env.local`, en `VITE_CONVEX_URL`, cambiando `.convex.cloud` por `.convex.site`).

5. **Variables de entorno en Convex**:

   ```sh
   npx convex env set AUTH_GOOGLE_ID "<client id>"
   npx convex env set AUTH_GOOGLE_SECRET "<client secret>"
   npx convex env set ADMIN_EMAILS "tu-correo@gmail.com"
   npx convex env set ALLOWED_EMAILS "chofer1@gmail.com, chofer2@gmail.com"
   ```

   - `ADMIN_EMAILS`: ven la vista de administrador.
   - `ALLOWED_EMAILS`: choferes.
   - Separa varios correos con comas. Los cambios aplican de inmediato: quitar un correo le quita el acceso sin tener que volver a publicar la app.
   - Cualquier cuenta de Google puede iniciar sesión, pero si su correo no está en ninguna lista solo verá el mensaje "Tu correo no tiene acceso" y no podrá leer ni guardar nada.

6. **Arrancar la app** en otra terminal:

   ```sh
   npm run dev
   ```

   Abre <http://localhost:5173>.

## Probar desde un teléfono en la misma red

La cámara y el GPS del navegador solo funcionan con HTTPS. Para probar desde un teléfono:

```sh
npm run dev:https
```

Abre en el teléfono la dirección `https://<ip-de-tu-computadora>:5173` que muestra la terminal (acepta el aviso del certificado de prueba) y agrega esa URL a los *Authorized JavaScript origins* de Google. Ten en cuenta que Convex Auth regresa al usuario a `SITE_URL` después del login, así que para esta prueba cambia temporalmente `SITE_URL` a esa misma dirección.

## Publicar

1. Despliega el backend: `npx convex deploy` (crea el deployment de producción; repite el paso 3 y el 5 con `--prod`, por ejemplo `npx convex env set --prod ADMIN_EMAILS ...`).
2. Publica el frontend en Vercel o Netlify con el comando de build
   `npx convex deploy --cmd 'npm run build'` y carpeta de salida `dist`
   (define `CONVEX_DEPLOY_KEY` en el hosting; ver la [guía de Convex](https://docs.convex.dev/production/hosting/)).
3. En producción: `SITE_URL` = la URL pública de la app, y agrega esa URL y el redirect URI de producción en Google Cloud Console.
4. Configura el hosting para que todas las rutas sirvan `index.html` (SPA), por ejemplo en Vercel con un rewrite de `/(.*)` a `/`.

## Modo sin señal

La app se puede instalar en el teléfono y funciona sin internet:

- **Instalar** (una vez por teléfono):
  - **Android (Chrome):** en la pantalla de inicio de la app aparece el botón **Instalar**, o menú ⋮ → *Instalar app*.
  - **iPhone (Safari):** botón **Compartir** → **Agregar a pantalla de inicio**. Luego abrir la app desde el ícono e **iniciar sesión ahí** (en iPhone la app instalada no comparte la sesión con Safari). Es importante instalarla: Safari puede borrar los datos guardados de un sitio tras 7 días sin usarlo, pero no los de las apps instaladas.
- **Sin señal:** el chofer abre la app y registra entregas normalmente (fotos y GPS funcionan sin internet). Al tocar *Guardar entrega* se guarda en el teléfono y aparece en **Por subir**.
- **Al volver la señal:** las entregas se suben solas mientras la app esté abierta (en iPhone no se suben con la app cerrada). La fecha y hora que quedan registradas son las del momento en que se guardó, no las de la subida. Si una entrega se sube dos veces por un corte de señal, el servidor la reconoce y no la duplica.
- Si el servidor rechaza una entrega, se queda en el teléfono marcada como *No se pudo subir* con el motivo y el botón **Reintentar**. Nunca se borra sola.
- Para salir de la cuenta hace falta señal, y la app avisa si quedan entregas sin subir.

**Al publicar esta versión por primera vez**, corre una vez (asigna la fecha de entrega a las entregas anteriores para que sigan apareciendo en los filtros por fecha):

```sh
npx convex run deliveries:backfillDeliveredAt          # desarrollo
npx convex run deliveries:backfillDeliveredAt --prod   # producción
```

Repítelo hasta que responda `done: true`.

**Al publicar la versión con ubicación guardada de clientes**, corre una vez (cada cliente toma la ubicación de su entrega más reciente; se puede repetir sin problema):

```sh
npx convex run clients:backfillLocations          # desarrollo
npx convex run clients:backfillLocations --prod   # producción
```

Después, agrega los vehículos en la pestaña **Vehículos**. Mientras no haya vehículos, el paso de vehículo no detiene al chofer.

## Recordatorios de pago

Cada cliente puede recibir avisos por correo, por WhatsApp o por ambos de sus entregas a **crédito** que siguen sin pagar: uno **una semana antes** de la fecha límite de pago y otro **el día que vence**.

- **Fecha límite** = día de la entrega + los *días de crédito* del cliente. Si cambias los días de crédito de un cliente, cambia la fecha límite de sus entregas pendientes.
- **Configurar un cliente:** pestaña **Clientes → Recordatorios…**: días de crédito, correo, WhatsApp y por dónde avisarle. **Enviar prueba** manda un mensaje de ejemplo a lo guardado, y ahí mismo se ven los últimos avisos enviados (y el motivo si alguno falló). Estos datos solo los ve el administrador; no se guardan en los teléfonos de los choferes.
- **Marcar como pagado:** en el detalle de la entrega. Una entrega pagada ya no genera avisos.
- **Un mensaje por cliente:** las facturas de un cliente que vencen el mismo día van juntas en un solo mensaje. Los mensajes llevan los números de factura y la fecha límite (la app no guarda importes).
- **Cuándo se envían:** todos los días a las 9:00 a.m. de Cozumel (`convex/crons.ts`). Si un envío falla, se reintenta al día siguiente (el aviso del día de vencimiento, hasta 3 días después).
- Con 7 días de crédito o menos solo se envía el aviso del día de vencimiento.

### Activarlos

Los avisos están **apagados** hasta definir `REMINDERS_START_DATE`. Solo las entregas hechas a partir de ese día generan avisos, así que las entregas a crédito anteriores nunca los envían:

```sh
npx convex env set REMINDERS_START_DATE "2026-12-01"          # desarrollo
npx convex env set --prod REMINDERS_START_DATE "2026-12-01"   # producción
```

Para apagarlos: `npx convex env remove REMINDERS_START_DATE`.

Para ver qué se enviaría sin enviar nada (y con otra fecha, para probar):

```sh
npx convex run reminders:run '{"dryRun": true}'
npx convex run reminders:run '{"dryRun": true, "today": "2026-12-15"}'
```

### Correo (Resend)

1. Crea una cuenta en [Resend](https://resend.com), agrega tu dominio y verifícalo con los registros DNS que indica.
2. Crea una API key y configura:

   ```sh
   npx convex env set RESEND_API_KEY "re_..."
   npx convex env set REMINDER_FROM_EMAIL "Bioclean Green Cozumel <cobranza@tu-dominio.com>"
   npx convex env set REMINDER_REPLY_TO "oficina@tu-dominio.com"   # opcional
   ```

### WhatsApp (WhatsApp Cloud API de Meta)

WhatsApp solo permite que una empresa inicie una conversación con **plantillas aprobadas por Meta**.

1. En [Meta for Developers](https://developers.facebook.com/) crea una app de tipo *Business* con el producto **WhatsApp**, ligada a tu portafolio de negocio, y registra el número desde el que se enviarán los avisos.
2. En *WhatsApp Manager → Plantillas de mensajes* crea estas dos plantillas, categoría **Utilidad**, idioma **Español (MEX)**, con tres variables en el cuerpo (nombre del cliente, facturas y fecha):

   - `recordatorio_pago_proximo`

     > Hola, {{1}}. Le recordamos que el pago de la(s) factura(s) {{2}} vence el {{3}}. Si ya realizó el pago, por favor haga caso omiso de este mensaje. Gracias. Bioclean Green Cozumel

   - `recordatorio_pago_vencimiento`

     > Hola, {{1}}. Le recordamos que la(s) factura(s) {{2}} tiene(n) como fecha límite de pago el {{3}}. Si ya realizó el pago, por favor haga caso omiso de este mensaje. Gracias. Bioclean Green Cozumel

3. Crea un *usuario del sistema* con un token permanente con permiso `whatsapp_business_messaging` y configura:

   ```sh
   npx convex env set WHATSAPP_TOKEN "<token>"
   npx convex env set WHATSAPP_PHONE_NUMBER_ID "<identificador del número>"
   ```

   Opcionales, si usas otros nombres o versión: `WHATSAPP_TEMPLATE_PROXIMO`, `WHATSAPP_TEMPLATE_VENCIMIENTO`, `WHATSAPP_TEMPLATE_LANG` (por defecto `es_MX`) y `WHATSAPP_API_VERSION` (por defecto `v26.0`).

4. Los clientes deben haber aceptado recibir mensajes de la empresa por WhatsApp (requisito de Meta).

Repite las variables con `--prod` para producción. Prueba cada cliente con **Enviar prueba** antes de activar los avisos.

**Íconos:** se generan desde `public/app-icon.svg` con `npx pwa-assets-generator`.

## Notas

- **Zona horaria:** las fechas se muestran y filtran en hora de Cozumel (UTC-5 todo el año).
- **Fotos:** se reducen en el teléfono (JPEG) antes de subirlas, para que suban rápido con datos móviles y ocupen poco espacio: la factura a máx. 1600 px, para que se lean el número y la firma; las de quien recibe y de la mercancía a máx. 1280 px. Los valores están en `PHOTO_PRESETS` (`src/lib/image.ts`).
- **Clientes:** si un chofer escribe un cliente que no existe, se crea automáticamente. Mayúsculas, acentos, puntos y espacios extra se ignoran al comparar ("Hotel Casa México." = "HOTEL CASA MEXICO"). Si aun así se crean duplicados, únelos en **Clientes → Fusionar**.
- **Factura repetida:** el asistente avisa (sin bloquear) si alguno de los números de factura ya se registró antes.
- **Ubicación del cliente:** la primera entrega de un cliente guarda su ubicación. En las siguientes, si el chofer la modifica a más de 75 m, la entrega queda marcada como *Ubicación modificada en esta entrega*. Al continuar con la ubicación guardada, la app toma el GPS del chofer en segundo plano como comprobante (se ve en el detalle de la entrega).
- **Pago:** una entrega a crédito se marca como pagada desde su detalle (solo el administrador). Las entregas anteriores a esta función conservan lo que registró el chofer.
- **Vehículos:** la lista se guarda en el teléfono como la de clientes, así que funciona sin señal. Eliminar un vehículo solo lo oculta para los choferes; las entregas anteriores lo conservan y se puede restaurar.

## Estructura

```
convex/            Backend: esquema, funciones y reglas de acceso
  lib/access.ts    Roles a partir de ADMIN_EMAILS / ALLOWED_EMAILS
  reminders.ts     Recordatorios de pago (correo y WhatsApp)
  lib/reminderEmail.ts  Diseño (HTML) del correo de recordatorio
  lib/emailLogo.ts      Logo del correo, servido en /email/logo.jpg (http.ts)
  crons.ts         Tarea diaria que los envía
  lib/due.ts       Fecha límite de pago y qué aviso toca cada día
src/
  pages/admin/     Entregas, Choferes, Clientes, Vehículos
  pages/driver/    Inicio del chofer y asistente de nueva entrega
  pages/DeliveryPage.tsx   Detalle de entrega (admin y chofer)
  lib/pdf.ts       Comprobante PDF
  lib/draft.ts     Borrador del asistente guardado en el teléfono
  lib/outbox.ts    Entregas guardadas en el teléfono esperando subirse
  lib/OutboxProvider.tsx  Sube esas entregas cuando hay señal
```
