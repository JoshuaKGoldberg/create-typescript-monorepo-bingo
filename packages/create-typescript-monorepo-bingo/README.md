# create-typescript-monorepo-bingo

Quickstart-friendly TypeScript monorepo template with comprehensive, configurable, opinionated tooling. 🗃️

```shell
npx create-typescript-monorepo-bingo
```

See [github.com/JoshuaKGoldberg/create-typescript-monorepo-bingo](https://github.com/JoshuaKGoldberg/create-typescript-monorepo-bingo#readme) for documentation.

## API

You can use the template with [Bingo](https://create.bingo)'s APIs:

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
