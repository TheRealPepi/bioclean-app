# Bioclean Green Cozumel · Entregas

Web app para registrar las entregas de los choferes y consultarlas desde la oficina.

- **Choferes (teléfono):** botón **+ Nueva entrega** → asistente paso a paso: cliente, número de factura, foto de la factura, foto de quien recibe, foto de la mercancía, ubicación GPS, estatus y anotaciones (obligatorias si el estatus no es "Entrega exitosa"). Ven sus entregas del día. Si se cierra el navegador o se va la señal, el avance (fotos incluidas) se guarda en el teléfono y pueden continuar.
- **Administrador (computadora):** tabla de entregas con filtros por fecha, chofer, cliente/factura y estatus; exportación a Excel (CSV); detalle de cada entrega con fotos y mapa; **Descargar PDF** del comprobante para adjuntarlo a un correo. Pestañas para ver choferes y para renombrar/fusionar clientes duplicados.

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

## Notas

- **Zona horaria:** las fechas se muestran y filtran en hora de Cozumel (UTC-5 todo el año).
- **Fotos:** se reducen en el teléfono (máx. 1600 px, JPEG) antes de subirlas, para que suban rápido con datos móviles.
- **Clientes:** si un chofer escribe un cliente que no existe, se crea automáticamente. Mayúsculas, acentos, puntos y espacios extra se ignoran al comparar ("Hotel Casa México." = "HOTEL CASA MEXICO"). Si aun así se crean duplicados, únelos en **Clientes → Fusionar**.
- **Factura repetida:** el asistente avisa (sin bloquear) si el número de factura ya se registró antes.

## Estructura

```
convex/            Backend: esquema, funciones y reglas de acceso
  lib/access.ts    Roles a partir de ADMIN_EMAILS / ALLOWED_EMAILS
src/
  pages/admin/     Entregas, Choferes, Clientes
  pages/driver/    Inicio del chofer y asistente de nueva entrega
  pages/DeliveryPage.tsx   Detalle de entrega (admin y chofer)
  lib/pdf.ts       Comprobante PDF
  lib/draft.ts     Borrador del asistente guardado en el teléfono
```
