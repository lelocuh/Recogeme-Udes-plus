# Recógeme UDES+ — versión para Vercel
Frontend estático (`public/`) + API serverless Express (`api/index.js`) + Upstash Redis para el estado compartido.
Tiempo real por sondeo cada 2 s (SSE y SQLite no funcionan en Vercel).

## Desplegar
1. Sube esta carpeta a un repositorio de GitHub.
2. En vercel.com: Add New > Project > importa el repo (sin framework, deja todo por defecto).
3. En el proyecto: Storage / Marketplace > agrega **Upstash Redis** y conéctalo (crea las variables solas).
4. En Settings > Environment Variables agrega `JWT_SECRET` (texto largo aleatorio). Opcional: `FARE` (tarifa, por defecto 3000), `DEMO_PAYMENTS=0` para apagar el pago simulado, `WEBHOOK_SECRET`.
5. Redeploy. Entra a la URL de Vercel. Sin Redis el demo no comparte datos entre usuarios.

Prueba local: `npm i -g vercel && npm i && vercel dev`.

## Usuarios demo (clave udes1234)
conductor@udes.test, admin@udes.test. Los pasajeros se registran solos (hay uno demo: pasajero@udes.test).

## Prueba para la sustentación
Conductor: Iniciar ruta > Simular recorrido > "Tráfico pesado". Pasajeros (otros celulares, registrados): ven el aviso en máx. 2 s,
marcan su punto en el mapa y reciben "bus cerca" a menos de 500 m. Cambia la tarifa con `FARE`.

## Pagos (importante)
El QR y el botón "Simular pago confirmado" son una DEMO. Un QR Nequi/Bre-B estático no avisa a la app: para confirmación automática
hay que integrar una pasarela (p. ej. Wompi, Bold) que llame a `POST /api/payments/webhook` con el header `x-webhook-secret`
y `{ticket, status:"APPROVED", receipt}`. Antes, define con la UDES quién recibe el dinero.

## Datos personales (Ley 1581 de 2012) — no es asesoría legal
Hecho: autorización expresa al registrarse (con fecha y versión), datos mínimos (nombre y correo), la ubicación del pasajero nunca sale de su celular,
eliminación de cuenta desde la app. Falta: completar el aviso de privacidad (responsable y contacto), política de tratamiento, canal de reclamos,
revisar si aplica el Registro Nacional de Bases de Datos y consultar a un abogado.

## Ruta
`public/route.json` está calcada de una captura (±150 m); las paradas intermedias son supuestos. Reemplázala con la traza GPS real.
