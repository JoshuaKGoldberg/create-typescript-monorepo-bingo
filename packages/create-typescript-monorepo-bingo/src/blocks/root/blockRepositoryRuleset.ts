import { z } from 'zod';

import { rootBase } from '../../bases/rootBase.ts';

export const blockRepositoryRuleset = rootBase.createBlock({
  about: {
    name: 'Repository Ruleset',
  },
  produce() {
    return {};
  },
  props: {
    requiredStatusChecks: z.array(z.string()).optional(),
  },
  setup({ options, props }) {
    return {
      requests: [
        {
          endpoint: 'POST /repos/{owner}/{repo}/rulesets',
          parameters: {
            bypass_actors: [
              {
                // The repository admin role
                actor_id: 5,
                actor_type: 'RepositoryRole',
                bypass_mode: 'always',
              },
            ],
            conditions: { ref_name: { exclude: [], include: ['refs/heads/main'] } },
            enforcement: 'active',
            name: 'Branch protection for main',
            owner: options.owner,
            repo: options.repository,
            rules: [
              { type: 'deletion' },
              {
                parameters: {
                  allowed_merge_methods: ['squash'],
                  dismiss_stale_reviews_on_push: false,
                  require_code_owner_review: false,
                  require_last_push_approval: false,
                  required_approving_review_count: 0,
                  required_review_thread_resolution: false,
                },
                type: 'pull_request',
              },
              {
                parameters: {
                  required_status_checks: [...new Set(props.requiredStatusChecks)]
                    .sort()
                    .map((context) => ({ context })),
                  strict_required_status_checks_policy: false,
                },
                type: 'required_status_checks',
              },
            ],
            target: 'branch',
          },
          type: 'octokit',
        },
      ],
    };
  },
});
