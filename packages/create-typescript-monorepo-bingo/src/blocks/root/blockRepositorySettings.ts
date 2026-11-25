import { rootBase } from '../../bases/rootBase.ts';

/**
 * Only new repositories' settings are set, as existing ones may intentionally differ.
 */
export const blockRepositorySettings = rootBase.createBlock({
  about: {
    name: 'Repository Settings',
  },
  produce() {
    return {};
  },
  setup({ options }) {
    const locator = { owner: options.owner, repo: options.repository };

    return {
      requests: [
        {
          endpoint: 'PATCH /repos/{owner}/{repo}',
          parameters: {
            ...locator,
            allow_auto_merge: true,
            allow_merge_commit: false,
            allow_rebase_merge: false,
            allow_squash_merge: true,
            delete_branch_on_merge: true,
            description: options.description,
            has_projects: false,
            has_wiki: false,
            security_and_analysis: {
              secret_scanning: { status: 'enabled' },
              secret_scanning_push_protection: { status: 'enabled' },
            },
            squash_merge_commit_message: 'PR_BODY',
            squash_merge_commit_title: 'PR_TITLE',
          },
          type: 'octokit',
        },
        ...(options.keywords?.length
          ? [
              {
                endpoint: 'PUT /repos/{owner}/{repo}/topics' as const,
                parameters: { ...locator, names: options.keywords.map(toTopic) },
                type: 'octokit' as const,
              },
            ]
          : []),
      ],
    };
  },
});

/**
 * GitHub only allows lowercase letters, numbers, and hyphens.
 */
function toTopic(keyword: string) {
  return keyword
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '');
}
