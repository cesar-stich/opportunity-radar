import { serve } from '@hono/node-server';
import { crearApp } from './app';
import { TelegramChannel } from './channels/telegram';
import { leerEnv } from './config';
import { crearDeps } from './deps';

const env = leerEnv();
const deps = crearDeps(env);

// 0.0.0.0: dentro de un contenedor hay que escuchar en todas las interfaces, no solo en localhost.
serve({ fetch: crearApp(deps).fetch, port: env.PORT, hostname: '0.0.0.0' }, (info) => {
  console.log(`📡 Radar escuchando en http://localhost:${info.port}`);
  console.log(`   LLM=${deps.llm.nombre} memoria=${deps.memoria.nombre} canal=${deps.canal.nombre} voz=${deps.voz.nombre}`);
  if (deps.canal.nombre !== 'mock') {
    if (deps.canal instanceof TelegramChannel) {
      // La URL del túnel cambia en cada arranque, así que el webhook se vuelve a registrar solo.
      if (!env.PUBLIC_URL) console.warn('   ⚠️ Falta PUBLIC_URL: sin ella no puedo decirle a Telegram a dónde mandar los mensajes');
      else {
        deps.canal
          .registrarWebhook(env.PUBLIC_URL)
          .then(() => console.log(`   Webhook de Telegram registrado: ${env.PUBLIC_URL}/webhook/telegram`))
          .catch((e) => console.error('   ❌ No se pudo registrar el webhook de Telegram:', (e as Error).message));
      }
    } else {
      console.log(`   Webhook para Zavu: <URL pública>/webhook/zavu  (eventos: message.inbound, conversation.new)`);
    }
    if (!env.ALLOWED_SENDERS.length) console.warn('   ⚠️ ALLOWED_SENDERS vacío: escríbele al bot y te dirá tu ID para ponerlo en .env');
  }
});
