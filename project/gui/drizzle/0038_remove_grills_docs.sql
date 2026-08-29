UPDATE `workspace_grant_tools`
SET `tools_json` = COALESCE(
  (
    SELECT json_group_array(value)
    FROM json_each(`workspace_grant_tools`.`tools_json`)
    WHERE value NOT IN (
      'workspace.docs',
      'workspace.grill',
      'workspace.list_docs',
      'workspace.get_doc',
      'workspace.set_grill_frontier',
      'workspace.propose_grill_issues',
      'workspace.propose_grill_writeup'
    )
  ),
  '[]'
),
`bundles_json` = COALESCE(
  (
    SELECT json_group_object(key, json(cleaned_tools))
    FROM (
      SELECT
        bundle.key AS key,
        COALESCE(
          (
            SELECT json_group_array(tool.value)
            FROM json_each(bundle.value) AS tool
            WHERE tool.value NOT IN (
              'workspace.docs',
              'workspace.grill',
              'workspace.list_docs',
              'workspace.get_doc',
              'workspace.set_grill_frontier',
              'workspace.propose_grill_issues',
              'workspace.propose_grill_writeup'
            )
          ),
          '[]'
        ) AS cleaned_tools
      FROM json_each(`workspace_grant_tools`.`bundles_json`) AS bundle
      WHERE bundle.key NOT IN (
        'workspace.docs',
        'workspace.grill',
        'workspace.list_docs',
        'workspace.get_doc',
        'workspace.set_grill_frontier',
        'workspace.propose_grill_issues',
        'workspace.propose_grill_writeup'
      )
    )
    WHERE json_array_length(cleaned_tools) > 0
  ),
  '{}'
)
WHERE `id` = 1;
--> statement-breakpoint
DROP TABLE `grill_attention`;
--> statement-breakpoint
DROP TABLE `grill_participant`;
--> statement-breakpoint
DROP TABLE `grill`;
--> statement-breakpoint
DROP TABLE `doc`;
