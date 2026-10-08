// Import Workers types as a module so they do not replace browser DOM globals.
declare module 'cloudflare:workers' {
  import { CloudflareWorkersModule } from '@cloudflare/workers-types';
  export = CloudflareWorkersModule;
}
