# Deliverado · Entregas

Web app para registrar las entregas de los choferes y consultarlas desde la oficina. La usan varias empresas en la misma instalación: cada una ve solo lo suyo y administra a sus propios usuarios (ver [Empresas, usuarios y roles](#empresas-usuarios-y-roles)).

- **Choferes (teléfono):** botón **+ Nueva entrega** → asistente paso a paso: cliente, vehículo, facturas (número y foto de cada una; botón **Agregar otra factura** si el cliente pide varias), foto de quien recibe, foto de la mercancía, ubicación, estatus, pago (**Pagado** o **Crédito**) y anotaciones (obligatorias si el estatus no es "Entrega exitosa"). En el paso de ubicación se muestra la ubicación guardada del cliente: el chofer toca **Continuar con esta ubicación** o **Modificar ubicación para esta entrega** (toma el GPS; solo cambia esa entrega, no la ubicación guardada del cliente). Ven sus entregas del día. Si se cierra el navegador o se va la señal, el avance (fotos incluidas) se guarda en el teléfono y pueden continuar.
- **Oficina (computadora):** tabla de entregas con filtros por fecha, chofer, cliente/factura y estatus; exportación a Excel (CSV); detalle de cada entrega con fotos y mapa; **Descargar PDF** del comprobante para adjuntarlo a un correo. Filtro por pago (pagado/crédito). Pestaña **Rutas** para planear el recorrido del día de un chofer (ver [Rutas](#rutas)). Pestañas para ver choferes, renombrar/fusionar clientes duplicados (y quitar la ubicación guardada de un cliente que se mudó) y agregar, renombrar o eliminar **Vehículos**. En **Clientes → Recordatorios…** se configuran los avisos de pago por correo o WhatsApp de las entregas a crédito, y en el detalle de una entrega a crédito está el botón **Marcar como pagado** (ver [Recordatorios de pago](#recordatorios-de-pago)). El dueño y los administradores tienen además la pestaña **Configuración**: datos de la empresa, usuarios y recordatorios.

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
   npx convex env set COMPANY_CREATOR_EMAILS "tu-correo@gmail.com"
   ```

   - `COMPANY_CREATOR_EMAILS`: los correos que pueden **crear una empresa**. Separa varios con comas. Al entrar con uno de ellos (y sin pertenecer todavía a una empresa) la app muestra el formulario *Crea tu empresa*; quien la crea queda como su dueño y agrega al resto desde **Configuración → Usuarios**.
   - Cualquier cuenta de Google puede iniciar sesión, pero si su correo no es usuario de ninguna empresa ni está en esa lista solo verá el mensaje "Tu correo no tiene acceso" y no podrá leer ni guardar nada.

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

1. Despliega el backend: `npx convex deploy` (crea el deployment de producción; repite el paso 3 y el 5 con `--prod`, por ejemplo `npx convex env set --prod COMPANY_CREATOR_EMAILS ...`).
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

## Rutas

En **Rutas → Nueva ruta** la oficina marca los clientes que toca visitar (en la lista o tocando sus puntos en el mapa), elige al chofer y crea la ruta.

- **Base:** la primera vez hay que fijar la base (la bodega). Se puede **escribir la dirección o el nombre del lugar** y elegir una de las sugerencias de Google: el mapa se acerca ahí con un pin que se puede arrastrar (o hacer clic en el punto exacto) y la base se guarda al tocar **Fijar base aquí**. También se puede marcar directo en el mapa o usar la ubicación del navegador. Las rutas se ordenan saliendo de la base; **Volver a la base al final** la agrega como último destino.
- **Orden de las paradas:** la app las ordena sola para recorrer menos, midiendo en línea recta (no conoce calles ni sentidos). Se puede cambiar a mano con las flechas; **Optimizar orden** vuelve al orden automático.
- **Clientes sin ubicación guardada:** aparecen como *Sin ubicación* y no se pueden marcar hasta darles una para la ruta con el botón del pin (ver abajo). Un cliente nuevo obtiene su ubicación guardada en su primera entrega.
- **Otra ubicación para la ruta:** el botón del pin, junto a cada cliente, le da una ubicación **solo para esa ruta** (buscando la dirección, haciendo clic en el mapa o arrastrando el pin). Sirve cuando la ubicación guardada está mal, cuando ese día se entrega en otro lugar, o para agregar a un cliente que aún no tiene ubicación. La ubicación guardada del cliente no cambia; para volver a ella, abre el pin y toca **Volver a la ubicación guardada**. El chofer ve un aviso en esa parada. **Editar** y **Usar de nuevo** conservan esas ubicaciones.
- **Editar:** mientras la ruta está activa, **Editar** abre la misma pantalla con sus paradas para agregar, quitar o reordenar, o cambiar de chofer. Sigue siendo la misma ruta: el chofer ve los cambios en su teléfono, vence cuando ya iba a vencer y las paradas ya entregadas siguen marcadas. Al guardar se abre de nuevo el mensaje para compartir, porque el enlace de Google Maps cambia con las paradas.
- **Compartir:** al crear la ruta se abre un mensaje listo para WhatsApp con la lista de paradas y el enlace de Google Maps. El enlace no lleva punto de partida, para que Google Maps navegue desde donde esté el chofer. Google Maps acepta 10 paradas por enlace: una ruta más larga (máx. 25 paradas) lleva varios enlaces, uno por tramo. Las paradas seguidas que están en la misma ubicación van en el enlace como una sola, porque Google Maps no abre una ruta con una parada repetida.
- **En el teléfono del chofer:** la ruta aparece en su pantalla de inicio como **Tu ruta**, también sin señal. Cada parada tiene **Navegar** y **Registrar entrega** (abre el asistente con el cliente ya elegido). Una parada se marca sola como entregada cuando se registra una entrega a ese cliente después de creada la ruta, de cualquier chofer.
- **Vigencia:** el chofer ve la ruta durante 24 horas desde que se creó (`ROUTE_TTL_MS` en `convex/lib/routes.ts`). Después queda en la pestaña como *Vencida* y una tarea diaria (`convex/crons.ts`, 3:00 a.m.) la borra a los 30 días. Las entregas nunca se borran. **Usar de nuevo** abre una ruta nueva con las mismas paradas.

### Llave de Google Maps

El mapa y el buscador de direcciones de **Nueva ruta** usan Google Maps. Sin la llave, la pestaña sigue funcionando (se arma la ruta con la lista), pero no hay mapa ni buscador.

1. En [Google Cloud Console](https://console.cloud.google.com/) (sirve el mismo proyecto del login con Google), liga una **cuenta de facturación** al proyecto.
2. En *APIs y servicios → Biblioteca* habilita **Maps JavaScript API** y **Places API (New)**.
3. En *Credenciales* crea una **clave de API**:
   - *Restricción de aplicación*: **Sitios web**, con `http://localhost:5173/*` y la URL pública de la app (`https://tu-dominio/*`).
   - *Restricción de API*: solo las dos APIs del paso 2.
4. Recomendado: en *Google Maps Platform → Administración de mapas* crea un **ID de mapa** de tipo JavaScript. Sin él se usa el de demostración de Google.
5. Agrega la llave en `.env.local` y en las variables de entorno del hosting (Netlify la lee al construir, así que hay que volver a publicar):

   ```
   VITE_GOOGLE_MAPS_API_KEY=...
   VITE_GOOGLE_MAPS_MAP_ID=...   # opcional
   ```

- **Costo:** Google da 10,000 usos gratis al mes de cada cosa (cargas del mapa, búsquedas y consultas de lugar); esta pestaña usa unas decenas. Para estar seguro de no pagar nunca, pon un límite diario de cuota en ambas APIs.
- **La llave es visible** para quien abra la app (es una llave de navegador): lo que la protege son las restricciones del paso 3.
- Lo que se escribe en el buscador se envía a Google, y solo busca dentro de Cozumel (`COZUMEL` en `src/lib/geocode.ts`).
- Si el mapa muestra *Google Maps rechazó la llave*, revisa los pasos 1 a 3 (facturación, APIs habilitadas y la dirección web permitida).
- Si el mapa carga pero el buscador dice *Google no aceptó la búsqueda*, falta **Places API (New)**: debe estar habilitada en el mismo proyecto de la llave (no confundir con la *Places API* anterior) y marcada en la *Restricción de API* de la llave. El cambio tarda unos minutos en aplicar.

## Recordatorios de pago

Cada cliente puede recibir avisos por correo, por WhatsApp o por ambos de sus entregas a **crédito** que siguen sin pagar: uno **una semana antes** de la fecha límite de pago y otro **el día que vence**.

- **Fecha límite** = día de la entrega + los *días de crédito* del cliente. Si cambias los días de crédito de un cliente, cambia la fecha límite de sus entregas pendientes.
- **Configurar un cliente:** pestaña **Clientes → Recordatorios…**: días de crédito, correo, WhatsApp y por dónde avisarle. **Enviar prueba** manda un mensaje de ejemplo a lo guardado, y ahí mismo se ven los últimos avisos enviados (y el motivo si alguno falló). Estos datos solo los ve la oficina; no se guardan en los teléfonos de los choferes.
- **Marcar como pagado:** en el detalle de la entrega. Una entrega pagada ya no genera avisos.
- **Un mensaje por cliente:** las facturas de un cliente que vencen el mismo día van juntas en un solo mensaje. Los mensajes llevan los números de factura y la fecha límite (la app no guarda importes).
- **Cuándo se envían:** todos los días a partir de las 9:00 a.m. en la zona horaria de cada empresa (una tarea revisa cada hora a qué empresas les toca; `convex/crons.ts`). Si un envío falla, se reintenta al día siguiente (el aviso del día de vencimiento, hasta 3 días después).
- Con 7 días de crédito o menos solo se envía el aviso del día de vencimiento.

### Activarlos

Cada empresa los enciende en **Configuración → Recordatorios**, eligiendo desde qué día de entrega se avisa. Solo las entregas hechas a partir de ese día generan avisos, así que las entregas a crédito anteriores nunca los envían. Sin fecha, están apagados.

Para ver qué se enviaría sin enviar nada (y con otra fecha, para probar). `companies:list` da el id de cada empresa:

```sh
npx convex run companies:list
npx convex run reminders:run '{"companyId": "<id>", "dryRun": true}'
npx convex run reminders:run '{"companyId": "<id>", "dryRun": true, "today": "2026-12-15"}'
```

### Correo (Resend)

Todas las empresas envían con la misma cuenta de [Resend](https://resend.com). Quien opera la instalación la configura una vez:

```sh
npx convex env set RESEND_API_KEY "re_..."
# Dirección compartida, en un dominio verificado en Resend, para las empresas sin dominio propio.
npx convex env set REMINDER_DEFAULT_FROM_EMAIL "avisos@tu-dominio.com"
```

- **Empresa sin dominio propio:** sus correos salen de esa dirección compartida, con el nombre de la empresa. Tiene que escribir un *correo de respuesta* en **Configuración → Recordatorios**, que es a donde llega lo que contesten sus clientes.
- **Empresa con dominio propio:** verifica su dominio en Resend (registros DNS) y actívalo. Desde entonces elige el nombre y lo que va antes de la arroba:

  ```sh
  npx convex run companies:setSenderDomain '{"companyId": "<id>", "senderDomain": "empresa.com"}'
  ```

  El dominio nunca se escribe desde la app: con una sola cuenta de Resend, una empresa podría enviar a nombre del dominio de otra.
- **Enviarme una prueba** (en esa misma pantalla) manda un recordatorio de ejemplo al correo del administrador y muestra el error de Resend si algo falla.

### WhatsApp (WhatsApp Cloud API de Meta)

Cada empresa usa su propia cuenta de WhatsApp Business. WhatsApp solo permite que una empresa inicie una conversación con **plantillas aprobadas por Meta**.

1. En [Meta for Developers](https://developers.facebook.com/) crea una app de tipo *Business* con el producto **WhatsApp**, ligada al portafolio de negocio de la empresa, y registra el número desde el que se enviarán los avisos.
2. En *WhatsApp Manager → Plantillas de mensajes* crea estas dos plantillas, categoría **Utilidad**, idioma **Español (MEX)**, con tres variables en el cuerpo (nombre del cliente, facturas y fecha):

   - `recordatorio_pago_proximo`

     > Hola, {{1}}. Le recordamos que el pago de la(s) factura(s) {{2}} vence el {{3}}. Si ya realizó el pago, por favor haga caso omiso de este mensaje. Gracias. *Nombre de la empresa*

   - `recordatorio_pago_vencimiento`

     > Hola, {{1}}. Le recordamos que la(s) factura(s) {{2}} tiene(n) como fecha límite de pago el {{3}}. Si ya realizó el pago, por favor haga caso omiso de este mensaje. Gracias. *Nombre de la empresa*

3. Crea un *usuario del sistema* con un token permanente con permiso `whatsapp_business_messaging`.
4. En **Configuración → Recordatorios → WhatsApp** escribe el *identificador del número de teléfono* y guarda el token. Si las plantillas tienen otros nombres o idioma, escríbelos ahí (por defecto, los de arriba y `es_MX`). El token se guarda aparte y la app nunca lo vuelve a mostrar.
5. Los clientes deben haber aceptado recibir mensajes de la empresa por WhatsApp (requisito de Meta).

`WHATSAPP_API_VERSION` (por defecto `v26.0`) es la única variable de WhatsApp que queda en Convex, y vale para todas las empresas. Prueba cada cliente con **Enviar prueba** antes de activar los avisos.

**Íconos:** se generan desde `public/app-icon.svg` con `npx pwa-assets-generator`.

## Empresas, usuarios y roles

- **Una empresa por correo.** Un correo es usuario de una sola empresa. Todo lo que se registra (clientes, entregas, facturas, vehículos, rutas, recordatorios) pertenece a la empresa de quien lo registró, y ninguna función devuelve ni cambia datos de otra.
- **Crear una empresa:** solo los correos de `COMPANY_CREATOR_EMAILS` (ver [Configuración inicial](#configuración-inicial)). Para dar de alta a un cliente nuevo, agrega su correo a esa variable y pídele que entre a la app.
- **Usuarios:** en **Configuración → Usuarios** se agrega el correo de Google de cada persona con su rol. No se envía invitación: la persona tiene acceso en cuanto entra con esa cuenta, y mientras tanto aparece como *Aún no ha entrado*. Cambiar el rol o quitar a alguien aplica en su siguiente acción.

  | Rol | Puede |
  | --- | --- |
  | **Dueño** | Todo. Es quien creó la empresa; no se puede quitar ni cambiar de rol. |
  | **Administrador** | Todo: el trabajo diario, los usuarios y la configuración de la empresa. |
  | **Oficina** | El trabajo diario: entregas, rutas, clientes, vehículos y pagos. No ve Configuración. |
  | **Chofer** | Registrar entregas desde su teléfono y ver sus rutas. |

- **Configuración → Empresa:** nombre (aparece en la app, en los PDF y en los recordatorios), lema, zona horaria (los días y las fechas límite de pago se cuentan en ella), clave de país de los teléfonos y zona de servicio (la búsqueda de direcciones al armar rutas se limita a ella).
- **Para quien opera la instalación** (comandos internos, no están en la app):

  ```sh
  npx convex run companies:list                                                     # empresas, dueños e ids
  npx convex run companies:setSenderDomain '{"companyId": "<id>", "senderDomain": "empresa.com"}'
  npx convex run members:transferOwnership '{"companyId": "<id>", "email": "nuevo-dueno@gmail.com"}'
  ```

### Publicar esta versión sobre la anterior

La versión anterior (la de "preparación") dejó creada la primera empresa y le asignó todos los datos, pero el acceso seguía saliendo de `ADMIN_EMAILS` y `ALLOWED_EMAILS`. Con esta versión el acceso sale de los usuarios de cada empresa. **Antes de publicarla**, todavía con la versión anterior en producción:

```sh
# 1. Respaldo.
npx convex export --prod --path respaldo.zip

# 2. Deja de cambiar ADMIN_EMAILS y ALLOWED_EMAILS, y copia por última vez las listas
#    (y la configuración de recordatorios) a la empresa.
npx convex run --prod migrations:backfillCompany '{"ownerEmail": "tu-correo@gmail.com"}'

# 3. Tiene que responder "ready": true. Si no, corre migrations:stampRows y vuelve a revisar.
npx convex run --prod migrations:status

# 4. Quién puede crear empresas, y la dirección compartida de los recordatorios.
npx convex env set --prod COMPANY_CREATOR_EMAILS "tu-correo@gmail.com"
npx convex env set --prod REMINDER_DEFAULT_FROM_EMAIL "avisos@tu-dominio.com"
```

Luego publica. Si alguna fila se quedó sin empresa, Convex rechaza la publicación y producción sigue en la versión anterior, sin cambios. Después de publicar:

- Entra como dueño, como alguien de oficina y como chofer, y revisa **Configuración → Usuarios** y **Recordatorios** (el remitente de la primera empresa quedó con el dominio que tenía `REMINDER_FROM_EMAIL`).
- No borres todavía `ADMIN_EMAILS`, `ALLOWED_EMAILS`, `REMINDERS_START_DATE`, `REMINDER_FROM_EMAIL`, `REMINDER_REPLY_TO` ni las `WHATSAPP_*`: ya no se leen, pero permiten volver a la versión anterior. Volver solo es seguro **mientras exista una sola empresa**, así que espera unos días de uso normal antes de crear la segunda. Después se pueden borrar.
- Los teléfonos de los choferes no necesitan nada: la app instalada se actualiza sola y conserva sus entregas pendientes de subir.

## Notas

- **Zona horaria:** las fechas se muestran y filtran en la zona horaria de la empresa (**Configuración → Empresa**), esté donde esté el teléfono o la computadora.
- **Fotos:** se reducen en el teléfono (JPEG) antes de subirlas, para que suban rápido con datos móviles y ocupen poco espacio: la factura a máx. 1600 px, para que se lean el número y la firma; las de quien recibe y de la mercancía a máx. 1280 px. Los valores están en `PHOTO_PRESETS` (`src/lib/image.ts`).
- **Clientes:** si un chofer escribe un cliente que no existe, se crea automáticamente. Mayúsculas, acentos, puntos y espacios extra se ignoran al comparar ("Hotel Casa México." = "HOTEL CASA MEXICO"). Si aun así se crean duplicados, únelos en **Clientes → Fusionar**.
- **Factura repetida:** si un número de factura ya está en otra entrega del mismo cliente (de cualquier chofer), el asistente pregunta si es un **seguimiento** de esa entrega. Con "Sí" el chofer continúa y la entrega queda marcada como *Seguimiento*; con "No" no puede continuar hasta corregir el número o quitar la factura, para no duplicar la entrega. Si la factura ya está registrada para **otro cliente** no hay seguimiento posible: el asistente no deja continuar hasta corregir el número o el cliente. Sin señal no se puede consultar: la entrega se guarda y, al subirse, queda marcada como *Posible duplicado* para que la oficina la revise (lo mismo si dos choferes registran la misma factura casi al mismo tiempo). Ambas marcas se ven en la lista de entregas, en el detalle y en el CSV.
- **Ubicación del cliente:** la primera entrega de un cliente guarda su ubicación. En las siguientes, si el chofer la modifica a más de 75 m, la entrega queda marcada como *Ubicación modificada en esta entrega*. Al continuar con la ubicación guardada, la app toma el GPS del chofer en segundo plano como comprobante (se ve en el detalle de la entrega).
- **Pago:** una entrega a crédito se marca como pagada desde su detalle (solo la oficina). Las entregas anteriores a esta función conservan lo que registró el chofer.
- **Vehículos:** la lista se guarda en el teléfono como la de clientes, así que funciona sin señal. Eliminar un vehículo solo lo oculta para los choferes; las entregas anteriores lo conservan y se puede restaurar.

## Estructura

```
convex/            Backend: esquema, funciones y reglas de acceso
  lib/access.ts    Quién puede qué: roles, permisos y a qué empresa pertenece cada fila
  companies.ts     Crear una empresa y su configuración
  members.ts       Usuarios de una empresa y sus roles
  lib/sender.ts    Remitente de los correos de cada empresa
  isolation.test.ts, tenancy.static.test.ts  Que una empresa nunca vea ni cambie lo de otra
  reminders.ts     Recordatorios de pago (correo y WhatsApp)
  lib/reminderEmail.ts  Diseño (HTML) del correo de recordatorio
  crons.ts         Tareas programadas: envía los recordatorios y borra rutas vencidas
  routes.ts        Rutas planeadas por la oficina
  lib/due.ts       Fecha límite de pago y qué aviso toca cada día
src/
  pages/admin/     Entregas, Rutas, Choferes, Clientes, Vehículos
  pages/admin/settings/  Configuración: Empresa, Usuarios, Recordatorios
  pages/login/     Entrar, sin acceso y crear empresa
  components/RouteMap.tsx  Mapa de la ruta (Google Maps)
  lib/routeOrder.ts  Orden de las paradas de una ruta
  lib/geocode.ts   Búsqueda de direcciones (Google Places) para fijar la base
  lib/googleMaps.ts  Carga de Google Maps con la llave
  pages/driver/    Inicio del chofer y asistente de nueva entrega
  pages/DeliveryPage.tsx   Detalle de entrega (admin y chofer)
  lib/pdf.ts       Comprobante PDF
  lib/draft.ts     Borrador del asistente guardado en el teléfono
  lib/outbox.ts    Entregas guardadas en el teléfono esperando subirse
  lib/OutboxProvider.tsx  Sube esas entregas cuando hay señal
```
