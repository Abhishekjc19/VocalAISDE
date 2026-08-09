import { NhostClient } from '@nhost/nextjs';

const nhost = new NhostClient({
  subdomain: 'wswbfudwrzygkeyjsofk',
  region: 'ap-south-1',
  authUrl: 'https://wswbfudwrzygkeyjsofk.auth.ap-south-1.nhost.run/v1',
  graphqlUrl: 'https://wswbfudwrzygkeyjsofk.graphql.ap-south-1.nhost.run/v1',
  storageUrl: 'https://wswbfudwrzygkeyjsofk.storage.ap-south-1.nhost.run/v1',
  functionsUrl: 'https://wswbfudwrzygkeyjsofk.functions.ap-south-1.nhost.run/v1',
});

export { nhost };
