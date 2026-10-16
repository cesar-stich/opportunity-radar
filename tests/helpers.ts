import { MockLLM } from '../src/agent/providers/mock';
import { MockChannel } from '../src/channels/zavu';
import { leerEnv } from '../src/config';
import { abrirDb } from '../src/db/index';
import { sembrar } from '../src/db/seed';
import { crearDeps, type Deps } from '../src/deps';
import { MockMemory } from '../src/memory/atomicmemory';

// Dependencias 100% mock con una base en memoria ya sembrada.
export function depsDePrueba(extra: Partial<Deps> = {}): Deps {
  const db = abrirDb(':memory:');
  sembrar(db);
  const env = leerEnv({ JOBS_TOKEN: 'secreto' });
  return crearDeps(extra.env ?? env, { db, llm: new MockLLM(), memoria: new MockMemory(), canal: new MockChannel(), ...extra });
}
