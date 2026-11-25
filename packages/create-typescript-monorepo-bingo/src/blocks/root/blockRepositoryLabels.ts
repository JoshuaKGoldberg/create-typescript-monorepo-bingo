// cspell:ignore ddcccc eeef ededed

import { rootBase } from '../../bases/rootBase.ts';

const labels: { color: string; description: string; name: string; replaces?: string }[] = [
  {
    color: 'f143ab',
    description: 'Barriers affecting people with disabilities ♿',
    name: 'area: accessibility',
    replaces: 'accessibility',
  },
  {
    color: '0075ca',
    description: 'Improvements or additions to docs 📝',
    name: 'area: documentation',
    replaces: 'documentation',
  },
  {
    color: '1177aa',
    description: "Improving how the repository's tests are run and/or code is tested 🧪",
    name: 'area: testing',
  },
  {
    color: 'f9d0c4',
    description: "Managing the repository's maintenance 🛠️",
    name: 'area: tooling',
  },
  {
    color: 'ededed',
    description: 'Updates to dependencies 📦',
    name: 'dependencies',
  },
  {
    color: '5319e7',
    description: 'Good for newcomers, please hop on! 🙌',
    name: 'good first issue',
    replaces: 'good first issue',
  },
  {
    color: '7a5901',
    description: "This doesn't seem right",
    name: 'invalid',
    replaces: 'invalid',
  },
  {
    color: '0e8a16',
    description: 'Please, send a pull request to resolve this! 🙏',
    name: 'status: accepting prs',
    replaces: 'help wanted',
  },
  {
    color: 'eeeeee',
    description: 'Issue is stale and/or no longer valid',
    name: 'status: aged away',
  },
  {
    color: 'ddcccc',
    description: 'Waiting for something else to be resolved 🙅',
    name: 'status: blocked',
  },
  {
    color: 'cfd3d7',
    description: 'This issue or pull request already exists',
    name: 'status: duplicate',
    replaces: 'duplicate',
  },
  {
    color: '05104f',
    description: 'Not yet ready for implementation or a pull request',
    name: 'status: in discussion',
  },
  {
    color: 'd3f82d',
    description: 'Further research required...? 🔎',
    name: 'status: needs investigation',
  },
  {
    color: 'e4bc82',
    description: 'Needs an action taken by the original poster',
    name: 'status: waiting for author',
  },
  {
    color: 'ffffff',
    description: 'This will not be worked on',
    name: 'status: wontfix',
    replaces: 'wontfix',
  },
  {
    color: 'd73a4a',
    description: "Something isn't working 🐛",
    name: 'type: bug',
    replaces: 'bug',
  },
  {
    color: 'fde282',
    description: 'Tech debt or other code/repository cleanups 🧹',
    name: 'type: cleanup',
  },
  {
    color: 'a2eeef',
    description: 'New enhancement or request 🚀',
    name: 'type: feature',
    replaces: 'enhancement',
  },
  {
    color: 'd876e3',
    description: 'Further information is requested',
    name: 'type: question',
    replaces: 'question',
  },
];

/**
 * New repositories start with GitHub's default labels, which are replaced by their equivalents.
 */
export const blockRepositoryLabels = rootBase.createBlock({
  about: {
    name: 'Repository Labels',
  },
  produce() {
    return {};
  },
  setup({ options }) {
    const locator = { owner: options.owner, repo: options.repository };

    return {
      requests: labels.map(({ color, description, name, replaces }) =>
        replaces
          ? {
              endpoint: 'PATCH /repos/{owner}/{repo}/labels/{name}',
              id: `label: ${name}`,
              parameters: { ...locator, color, description, name: replaces, new_name: name },
              type: 'octokit',
            }
          : {
              endpoint: 'POST /repos/{owner}/{repo}/labels',
              id: `label: ${name}`,
              parameters: { ...locator, color, description, name },
              type: 'octokit',
            },
      ),
    };
  },
});
