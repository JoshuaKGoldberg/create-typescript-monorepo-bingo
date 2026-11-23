# create-typescript-monorepo-bingo

Quickstart-friendly TypeScript monorepo template with comprehensive, configurable, opinionated tooling. 🗃️

```shell
npx create-typescript-monorepo-bingo
```

See the [repository README](https://github.com/JoshuaKGoldberg/create-typescript-monorepo-bingo#readme) for usage and options.

## API

The template and its Blocks are exported for use with [Bingo](https://create.bingo) APIs:

```ts
import { produceTemplate } from 'bingo';
import { template } from 'create-typescript-monorepo-bingo';

const creation = await produceTemplate(template, {
  options: {
    description: 'My monorepo.',
    owner: 'my-org',
    repository: 'my-repo',
    title: 'My Repo',
  },
});
```
