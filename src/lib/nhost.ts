import { VanillaNhostClient as NhostClient } from '@nhost/nextjs';

const nhost = new NhostClient({
  subdomain: process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN || 'wswbfudwrzygkeyjsofk',
  region: process.env.NEXT_PUBLIC_NHOST_REGION || 'ap-south-1',
});

export { nhost };
