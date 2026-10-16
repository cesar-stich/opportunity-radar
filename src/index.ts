import { serve } from '@hono/node-server';
import { crearApp } from './app';
import { leerEnv } from './config';
import { crearDeps } from './deps';

const env = leerEnv();
const deps = crearDeps(env);

// 0.0.0.0: dentro de un contenedor hay que escuchar en todas las interfaces, no solo en localhost.
serve({ fetch: crearApp(deps).fetch, port: env.PORT, hostname: '0.0.0.0' }, (info) => {
  console.log(`📡 Radar escuchando en http://localhost:${info.port}`);
  console.log(`   LLM=${deps.llm.nombre} memoria=${deps.memoria.nombre} canal=${deps.canal.nombre} voz=${deps.voz.nombre}`);
  if (deps.canal.nombre !== 'mock') {
    console.log(`   Webhook para Zavu: <URL pública>/webhook/zavu  (eventos: message.inbound, conversation.new)`);
    if (!env.ALLOWED_SENDERS.length) console.warn('   ⚠️ ALLOWED_SENDERS vacío: escríbele al bot y te dirá tu ID para ponerlo en .env');
  }
});
