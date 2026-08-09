import { NhostClient } from '@nhost/nextjs';

const nhost = new NhostClient({
  subdomain: process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN || 'local',
  region: process.env.NEXT_PUBLIC_NHOST_REGION || '',
  authUrl: process.env.NEXT_PUBLIC_NHOST_AUTH_URL || 'http://localhost:1337/v1/auth',
  graphqlUrl: process.env.NEXT_PUBLIC_NHOST_GRAPHQL_URL || 'http://localhost:1337/v1/graphql',
  storageUrl: process.env.NEXT_PUBLIC_NHOST_STORAGE_URL || 'http://localhost:1337/v1/storage',
  functionsUrl: process.env.NEXT_PUBLIC_NHOST_FUNCTIONS_URL || 'http://localhost:1337/v1/functions',
});

export { nhost };
